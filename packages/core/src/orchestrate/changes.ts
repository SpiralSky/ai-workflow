import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Directory names never walked or reported, at any depth (orchestrate-engine §7). */
export const IGNORED_DIRS = [".git", "node_modules", "__pycache__", ".pytest_cache", ".venv"];

/** Recorded state of one file. `sha1` is `""` when the file was not hashed (see {@link snapshotWorkspace}). */
export interface FileState {
  size: number;
  mtimeMs: number;
  sha1: string;
}

/** `path` (relative to the root, `/` separated) → file state. */
export type Snapshot = Map<string, FileState>;

/** Result of comparing two snapshots; every list is sorted. */
export interface ChangeSet {
  added: string[];
  modified: string[];
  deleted: string[];
}

/**
 * A minimal `.gitignore` matcher for the workspace root file. Supported: blank lines and `#`
 * comments, plain names (match at any depth), `dir/` (directories only), a leading `/` or an inner
 * `/` (anchored to the root), `*`, `?` and `**` globs. NOT supported: `!` negation, character
 * classes, nested `.gitignore` files; such lines are skipped.
 * @param gitignore - the text of the root `.gitignore`
 * @returns a predicate over a relative path and whether it is a directory
 */
export function gitignoreMatcher(gitignore: string): (relPath: string, isDir: boolean) => boolean {
  const rules: { re: RegExp; dirOnly: boolean; anchored: boolean }[] = [];
  for (const raw of gitignore.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!") || /\[/.test(line)) continue;
    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes("/");
    line = line.replace(/^\//, "");
    if (!line) continue;
    const src = line
      .replace(/[.+^${}()|\\]/g, "\\$&")
      .replace(/\*\*/g, "\u0000")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/\u0000/g, ".*");
    rules.push({ re: new RegExp(`^${src}$`), dirOnly, anchored });
  }
  return (relPath, isDir) => {
    const base = relPath.slice(relPath.lastIndexOf("/") + 1);
    return rules.some((r) => (!r.dirOnly || isDir) && r.re.test(r.anchored ? relPath : base));
  };
}

/** True when `relPath` lies inside one of the always-ignored directories. */
function inIgnoredDir(relPath: string): boolean {
  return relPath.split("/").some((seg) => IGNORED_DIRS.includes(seg));
}

/** Lists files by walking `root`, skipping ignored directories and root `.gitignore` matches. */
async function walk(root: string): Promise<string[]> {
  let matcher = (_p: string, _d: boolean) => false;
  try {
    matcher = gitignoreMatcher(await readFile(join(root, ".gitignore"), "utf8"));
  } catch {
    // no .gitignore
  }
  const out: string[] = [];
  const visit = async (rel: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (IGNORED_DIRS.includes(e.name) || matcher(p, true)) continue;
        await visit(p);
      } else if (e.isFile() && !matcher(p, false)) out.push(p);
    }
  };
  await visit("");
  return out;
}

/** Runs git in `root`; returns stdout or `undefined` when git is unavailable or `root` is no repository. */
async function git(root: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
    return stdout;
  } catch {
    return undefined;
  }
}

/** Lists files and the set of dirty ones through git, or `undefined` when `root` is not a git repository. */
async function gitFiles(root: string): Promise<{ files: string[]; dirty: Set<string> } | undefined> {
  const listed = await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (listed === undefined) return undefined;
  const status = (await git(root, ["status", "--porcelain", "-z", "--untracked-files=all"])) ?? "";
  const dirty = new Set<string>();
  const parts = status.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]!;
    if (e.length < 4) continue;
    dirty.add(e.slice(3));
    if (e[0] === "R" || e[0] === "C") i++; // rename entries are followed by the old path
  }
  return { files: [...new Set(listed.split("\0").filter(Boolean))], dirty };
}

/** SHA-1 hex digest of a file's content. */
async function hashFile(path: string): Promise<string> {
  return createHash("sha1").update(await readFile(path)).digest("hex");
}

/**
 * Snapshots the workspace under `root`: `path → {size, mtimeMs, sha1}`. A file is re-hashed only
 * when its size or mtime differs from `prev`; otherwise the previous hash is reused.
 *
 * When `root` is a git repository the file list comes from `git ls-files` (tracked plus untracked,
 * honouring every `.gitignore`) and, on a first snapshot (no `prev`), only files that
 * `git status --porcelain` reports dirty are hashed; clean files get `sha1: ""` (stat only). A
 * later change to such a file is therefore reported as modified even if its content is identical.
 * Outside git the tree is walked, with the limited `.gitignore` support of {@link gitignoreMatcher}.
 * Always ignored: {@link IGNORED_DIRS}. Symlinks are not followed.
 * @param root - absolute workspace root
 * @param prev - the previous snapshot, to avoid re-hashing
 * @returns the new snapshot
 */
export async function snapshotWorkspace(root: string, prev?: Snapshot): Promise<Snapshot> {
  const viaGit = await gitFiles(root);
  const files = (viaGit ? viaGit.files : await walk(root)).filter((p) => !inIgnoredDir(p)).sort();
  const snap: Snapshot = new Map();
  const toHash: string[] = [];
  for (const p of files) {
    let st;
    try {
      st = await lstat(join(root, p));
    } catch {
      continue; // vanished or tracked-but-deleted
    }
    if (!st.isFile()) continue;
    const old = prev?.get(p);
    if (old && old.size === st.size && old.mtimeMs === st.mtimeMs) {
      snap.set(p, old);
      continue;
    }
    snap.set(p, { size: st.size, mtimeMs: st.mtimeMs, sha1: "" });
    if (!viaGit || prev || viaGit.dirty.has(p)) toHash.push(p);
  }
  for (let i = 0; i < toHash.length; i += 32) {
    await Promise.all(
      toHash.slice(i, i + 32).map(async (p) => {
        try {
          snap.get(p)!.sha1 = await hashFile(join(root, p));
        } catch {
          snap.delete(p);
        }
      }),
    );
  }
  return snap;
}

/**
 * Compares two snapshots.
 * @param before - earlier snapshot
 * @param after - later snapshot
 * @returns sorted added, modified (hash differs, or size/mtime differs where a hash is missing) and deleted paths
 */
export function diffSnapshots(before: Snapshot, after: Snapshot): ChangeSet {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const [p, a] of after) {
    const b = before.get(p);
    if (!b) added.push(p);
    else if (b.sha1 && a.sha1 ? b.sha1 !== a.sha1 : b.size !== a.size || b.mtimeMs !== a.mtimeMs) modified.push(p);
  }
  for (const p of before.keys()) if (!after.has(p)) deleted.push(p);
  return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort() };
}

/** Tracks workspace changes across steps: call `begin()` before a step and `end()` after it. */
export class ChangeTracker {
  private last?: Snapshot;
  private start?: Snapshot;

  /** @param root - absolute workspace root */
  constructor(readonly root: string) {}

  /** Takes the before-step snapshot (reusing hashes from the previous one). */
  async begin(): Promise<void> {
    this.last = this.start = await snapshotWorkspace(this.root, this.last);
  }

  /**
   * Takes the after-step snapshot and diffs it against the one from `begin()`.
   * @returns the changes made during the step
   * @throws if `begin()` was not called
   */
  async end(): Promise<ChangeSet> {
    if (!this.start) throw new Error("ChangeTracker.end() before begin()");
    const after = await snapshotWorkspace(this.root, this.last);
    this.last = after;
    return diffSnapshots(this.start, after);
  }
}
