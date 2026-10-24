import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, matchesGlob } from "node:path";
import { relPath } from "./paths.ts";

/** Directory names never searched (both backends). */
const SKIP_DIRS = new Set([".git", "node_modules"]);
/** Byte budget for a list result before it is cut with a `truncated` hint. */
export const LIST_BUDGET_BYTES = 6000;

let rgOK: boolean | undefined;
/** Whether `rg` is on PATH (cached). */
export function hasRg(): boolean {
  rgOK ??= spawnSync("rg", ["--version"], { stdio: "ignore" }).status === 0;
  return rgOK;
}

/**
 * Whether a root-relative path matches a glob. A glob without `/` matches the base name at any
 * depth (as `rg -g` does); one with `/` is matched against the whole relative path.
 */
export function globMatch(rel: string, glob: string): boolean {
  return glob.includes("/") ? matchesGlob(rel, glob.replace(/^\//, "")) : matchesGlob(basename(rel), glob);
}

/** Runs rg in `root`, returning stdout lines. Exit code 1 (no matches) is not an error. */
function runRg(root: string, args: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("rg", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || code === 1) resolve(out.split("\n").filter(Boolean));
      else reject(new Error(`rg failed: ${err.trim()}`));
    });
  });
}

/** Walks files under `startAbs` (also used by fs and vcs tools), skipping `.git` and `node_modules`; yields absolute paths. */
export function* walk(startAbs: string): Generator<string> {
  const st = statSync(startAbs);
  if (st.isFile()) { yield startAbs; return; }
  for (const e of readdirSync(startAbs, { withFileTypes: true })) {
    const p = join(startAbs, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(p); }
    else if (e.isFile()) yield p;
  }
}

/** Common rg flags: no ignore files, include hidden, skip .git and node_modules, so it matches the JS walk. */
const RG_BASE = ["--no-ignore", "--hidden", "--no-messages", "-g", "!.git", "-g", "!node_modules"];

/** One grep hit. */
export interface GrepMatch { path: string; line: number; text: string }

/** Longest match line kept, in characters. */
const MAX_LINE = 200;
const clip = (s: string) => (s.length > MAX_LINE ? s.slice(0, MAX_LINE) + "…" : s);

/**
 * Regex content search using ripgrep. Returns all matches sorted by path then line.
 * @param root - absolute workspace root
 * @param startRel - root-relative file or directory to search (`.` for all)
 */
export async function grepRg(root: string, pattern: string, startRel: string, glob: string | undefined, ignoreCase: boolean): Promise<GrepMatch[]> {
  const args = ["--json", ...RG_BASE];
  if (ignoreCase) args.push("-i");
  if (glob) args.push("-g", glob);
  args.push("-e", pattern, "--", startRel);
  const res: GrepMatch[] = [];
  for (const l of await runRg(root, args)) {
    const ev = JSON.parse(l);
    if (ev.type !== "match") continue;
    const text: string = ev.data.lines.text ?? "";
    res.push({ path: ev.data.path.text.replace(/^\.\//, ""), line: ev.data.line_number, text: clip(text.replace(/\r?\n$/, "")) });
  }
  return sortMatches(res);
}

/** Same as `grepRg` using a JS directory walk and `RegExp` (binary files, with a NUL in the first 8 KB, are skipped). */
export function grepJS(root: string, absStart: string, pattern: string, glob: string | undefined, ignoreCase: boolean): GrepMatch[] {
  const re = new RegExp(pattern, ignoreCase ? "i" : "");
  const res: GrepMatch[] = [];
  for (const abs of walk(absStart)) {
    const rel = relPath(root, abs);
    if (glob && !globMatch(rel, glob)) continue;
    const buf = readFileSync(abs);
    if (buf.subarray(0, 8192).includes(0)) continue;
    const ls = buf.toString("utf8").split("\n");
    if (ls[ls.length - 1] === "") ls.pop();
    ls.forEach((text, i) => {
      text = text.replace(/\r$/, "");
      if (re.test(text)) res.push({ path: rel, line: i + 1, text: clip(text) });
    });
  }
  return sortMatches(res);
}

/** Sorts by path (code-unit order) then line. */
function sortMatches(m: GrepMatch[]): GrepMatch[] {
  return m.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
}

/** Glob over file paths using `rg --files`; sorted root-relative paths. */
export async function filesRg(root: string, pattern: string, startRel: string): Promise<string[]> {
  const out = await runRg(root, ["--files", ...RG_BASE, "-g", pattern, "--", startRel]);
  return out.map((p) => p.replace(/^\.\//, "")).sort();
}

/** Same as `filesRg` using a JS walk and `path.matchesGlob`. */
export function filesJS(root: string, absStart: string, pattern: string): string[] {
  const res: string[] = [];
  for (const abs of walk(absStart)) {
    const rel = relPath(root, abs);
    if (globMatch(rel, pattern)) res.push(rel);
  }
  return res.sort();
}

/**
 * Cuts a sorted list to a count and a serialised-size budget.
 * @returns the kept items and a hint when anything was dropped
 */
export function cutList<T>(items: T[], maxCount: number, hint: string): { kept: T[]; truncated?: string } {
  const kept: T[] = [];
  let bytes = 0;
  for (const it of items) {
    bytes += Buffer.byteLength(JSON.stringify(it)) + 1;
    if (kept.length >= maxCount || bytes > LIST_BUDGET_BYTES) break;
    kept.push(it);
  }
  return kept.length < items.length ? { kept, truncated: `showing ${kept.length} of ${items.length}; ${hint}` } : { kept };
}
