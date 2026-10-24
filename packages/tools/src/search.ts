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

/** One parsed ignore-file line. `dir` is the root-relative directory of the ignore file ("" for the root). */
interface IgnoreRule { dir: string; glob: string; anchored: boolean; negate: boolean; dirOnly: boolean }

/** Parses the common subset of gitignore syntax: comments, `!`, trailing `/`, leading `/`, `*`, `**`, `?`. */
function parseIgnore(text: string, dir: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (let line of text.split("\n")) {
    line = line.replace(/\r$/, "").replace(/(?<!\\)\s+$/, "");
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes("/");
    line = line.replace(/^\//, "");
    if (line) rules.push({ dir, glob: line, anchored, negate, dirOnly });
  }
  return rules;
}

/** Reads the ignore files of one directory (`.gitignore`, then `.ignore`; later rules win; root also reads `.git/info/exclude`). */
function loadIgnore(root: string, dirRel: string): IgnoreRule[] {
  const abs = join(root, dirRel);
  const names = dirRel === "" ? [join(".git", "info", "exclude"), ".gitignore", ".ignore"] : [".gitignore", ".ignore"];
  const rules: IgnoreRule[] = [];
  for (const n of names) {
    try { rules.push(...parseIgnore(readFileSync(join(abs, n), "utf8"), dirRel)); } catch { /* no such file */ }
  }
  return rules;
}

/** Whether `rel` (root-relative) is ignored by `rules`; the last matching rule wins. */
function isIgnored(rules: IgnoreRule[], rel: string, isDir: boolean): boolean {
  let ignored = false;
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    const sub = r.dir ? rel.slice(r.dir.length + 1) : rel;
    if (matchesGlob(r.anchored ? sub : basename(sub), r.glob)) ignored = !r.negate;
  }
  return ignored;
}

/**
 * Walks files under `startAbs` like rg's defaults (used by `grepJS` and `filesJS`): skips `.git`,
 * `node_modules`, hidden entries and paths ignored by `.gitignore`/`.ignore` files (nested, from
 * `root` down) and `.git/info/exclude`. A file given as `startAbs` is always yielded.
 */
export function* walkSearch(root: string, startAbs: string): Generator<string> {
  if (statSync(startAbs).isFile()) { yield startAbs; return; }
  const startRel = relPath(root, startAbs);
  const dirs = startRel === "." || startRel === "" ? [] : startRel.split(/[\\/]/);
  const rules = loadIgnore(root, "");
  for (let i = 1; i <= dirs.length; i++) rules.push(...loadIgnore(root, dirs.slice(0, i).join("/")));
  yield* walkRules(root, startAbs, startRel === "." ? "" : startRel, rules);
}

function* walkRules(root: string, abs: string, rel: string, inherited: IgnoreRule[]): Generator<string> {
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (e.name.startsWith(".") || !(e.isDirectory() || e.isFile())) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    const isDir = e.isDirectory();
    if (isDir && SKIP_DIRS.has(e.name)) continue;
    if (isIgnored(inherited, childRel, isDir)) continue;
    const p = join(abs, e.name);
    if (!isDir) yield p;
    else yield* walkRules(root, p, childRel, [...inherited, ...loadIgnore(root, childRel)]);
  }
}

/**
 * Common rg flags: rg defaults (respect ignore files, skip hidden), `--no-require-git` so ignore
 * files apply outside a git repo, and `.git` / `node_modules` skipped. Globs are applied in JS
 * (`globMatch`), because an `rg -g` whitelist would override the ignore rules.
 */
const RG_BASE = ["--no-require-git", "--no-messages", "-g", "!.git", "-g", "!node_modules"];

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
  args.push("-e", pattern, "--", startRel);
  const res: GrepMatch[] = [];
  for (const l of await runRg(root, args)) {
    const ev = JSON.parse(l);
    if (ev.type !== "match") continue;
    const text: string = ev.data.lines.text ?? "";
    const path: string = ev.data.path.text.replace(/^\.\//, "");
    if (glob && !globMatch(path, glob)) continue;
    res.push({ path, line: ev.data.line_number, text: clip(text.replace(/\r?\n$/, "")) });
  }
  return sortMatches(res);
}

/** Same as `grepRg` using a JS directory walk and `RegExp` (binary files, with a NUL in the first 8 KB, are skipped). */
export function grepJS(root: string, absStart: string, pattern: string, glob: string | undefined, ignoreCase: boolean): GrepMatch[] {
  const re = new RegExp(pattern, ignoreCase ? "i" : "");
  const res: GrepMatch[] = [];
  for (const abs of walkSearch(root, absStart)) {
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
  const out = await runRg(root, ["--files", ...RG_BASE, "--", startRel]);
  return out.map((p) => p.replace(/^\.\//, "")).filter((p) => globMatch(p, pattern)).sort();
}

/** Same as `filesRg` using a JS walk and `path.matchesGlob`. */
export function filesJS(root: string, absStart: string, pattern: string): string[] {
  const res: string[] = [];
  for (const abs of walkSearch(root, absStart)) {
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
