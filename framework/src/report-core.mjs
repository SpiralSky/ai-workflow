// Change report core, shared by the MCP server (via report.ts) and the hook scripts (plain JS, no build step).
// Flow per turn: UserPromptSubmit hook snapshots the workspace -> Stop hook (or the returnUser PostToolUse hook) diffs it.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", "__pycache__", ".branch-traces", ".venv", "venv", "dist", "build", ".next", "target", ".cache"]);
const MAX_FILE = 200 * 1024;
const MAX_FILES = 5000;
const MAX_TOTAL = 20 * 1024 * 1024; // text kept in a snapshot; beyond this files become hash sentinels
const OPAQUE = "\0opaque:"; // value for binary/large/over-budget files: size + hash, no content

const sha = (b) => createHash("sha1").update(b).digest("hex");
const isOpaque = (v) => typeof v === "string" && v.startsWith(OPAQUE);

function listFiles(cwd) {
  try {
    const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
    return [...new Set(out.split("\0").filter(Boolean))].filter((r) => !r.split("/").some((p) => SKIP_DIRS.has(p)));
  } catch { /* not a git repo */ }
  const files = [];
  const walk = (rel) => {
    let ents;
    try { ents = readdirSync(join(cwd, rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (files.length > MAX_FILES) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(r); }
      else if (e.isFile()) files.push(r);
    }
  };
  walk("");
  return files;
}

/** @returns {Map<string,string> & {capped?: boolean}} relative path -> text content, or an opaque sentinel (size+hash) for binary/large files */
export function snapshot(cwd) {
  const snap = new Map();
  let total = 0;
  for (const r of listFiles(cwd).sort()) {
    if (snap.size >= MAX_FILES) { snap.capped = true; break; }
    try {
      const abs = join(cwd, r), st = statSync(abs);
      if (!st.isFile()) continue;
      let v;
      if (st.size <= MAX_FILE && total + st.size <= MAX_TOTAL) {
        const buf = readFileSync(abs);
        v = buf.includes(0) ? undefined : buf.toString("utf8");
        if (v === undefined) v = `${OPAQUE}${buf.length}:${sha(buf)}`; else total += buf.length;
      } else v = `${OPAQUE}${st.size}:${sha(readFileSync(abs))}`;
      snap.set(r, v);
    } catch { /* unreadable or vanished: ignore */ }
  }
  return snap;
}

const lines = (s) => (s === "" ? [] : s.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n"));

// Line-level diff counts via LCS (common prefix/suffix trimmed first).
export function lineDiff(a, b) {
  const x = lines(a), y = lines(b);
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let q = 0;
  while (q < x.length - p && q < y.length - p && x[x.length - 1 - q] === y[y.length - 1 - q]) q++;
  const xm = x.slice(p, x.length - q), ym = y.slice(p, y.length - q);
  if (!xm.length || !ym.length || xm.length * ym.length > 4_000_000) return { added: ym.length, deleted: xm.length };
  let prev = new Uint32Array(ym.length + 1), cur = new Uint32Array(ym.length + 1);
  for (let i = 1; i <= xm.length; i++) {
    for (let j = 1; j <= ym.length; j++)
      cur[j] = xm[i - 1] === ym[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev];
  }
  const lcs = prev[ym.length];
  return { added: ym.length - lcs, deleted: xm.length - lcs };
}

export function diffSnapshots(before, after) {
  const out = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const a = before.get(path), b = after.get(path);
    if (a === b) continue;
    if ((a === undefined && before.capped) || (b === undefined && after.capped)) continue; // not seen because of the file cap: unknown, not deleted/new
    if (isOpaque(a) || isOpaque(b)) out.push({ path, added: 0, deleted: 0, opaque: true });
    else out.push({ path, ...lineDiff(a ?? "", b ?? "") });
  }
  return out;
}

export function formatAuto(changes, tests, capped = false) {
  const note = capped ? " [file cap hit: report may be incomplete]" : "";
  if (!changes.length) return "No file changes." + note;
  const files = changes.map((c) => (c.opaque ? `${c.path} (modified, binary/large)` : `${c.path} (+${c.added} −${c.deleted})`)).join(", ");
  return `Changes: ${files}${tests === undefined ? "" : ` · tests: ${tests ? "ok" : "fail"}`}${note}`;
}

// ---- per-turn state (shared via files: hooks and the MCP server are separate processes)
export const traceDir = () => process.env.BRANCH_TRACE_DIR ?? join(homedir(), ".claude", "branch-traces");
const stateDir = () => join(traceDir(), "state");
const safe = (s) => String(s ?? "x").replace(/[^\w.-]/g, "_");
const snapPath = (sid) => join(stateDir(), `snap-${safe(sid)}.json`);
const testsPath = (cwd) => join(stateDir(), `tests-${createHash("sha1").update(resolve(cwd)).digest("hex").slice(0, 12)}.json`);

/** Called by the server after a branch ran runTests: latest result for this workspace. */
export function recordTests(cwd, ok) {
  try { mkdirSync(stateDir(), { recursive: true }); writeFileSync(testsPath(cwd), JSON.stringify({ ts: Date.now(), ok })); } catch { /* best effort */ }
}

const MAX_AGE = 24 * 3600 * 1000;
function cleanOld() {
  try {
    for (const f of readdirSync(stateDir())) {
      if (!/^(snap|tests)-.*\.json$/.test(f)) continue;
      try { if (Date.now() - statSync(join(stateDir(), f)).mtimeMs > MAX_AGE) rmSync(join(stateDir(), f), { force: true }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/** UserPromptSubmit: remember the workspace as it is before this turn's work. */
export function saveSnapshot(sid, cwd) {
  try {
    mkdirSync(stateDir(), { recursive: true });
    cleanOld();
    const snap = snapshot(cwd);
    writeFileSync(snapPath(sid), JSON.stringify({ ts: Date.now(), cwd, capped: !!snap.capped, files: Object.fromEntries(snap) }));
  } catch { /* best effort */ }
}

/**
 * Diff the workspace against this turn's snapshot, once per turn (the snapshot is deleted when consumed, so the Stop hook
 * stays silent after the returnUser hook reported). `cwd` (hook input) follows `cd`, so the saved snapshot cwd is diffed.
 * `force` keeps an empty diff ("No file changes."); otherwise empty turns produce no report.
 * The tests file is keyed by workspace and not deleted here (concurrent sessions); the ts check ignores stale results.
 */
export function takeReport(sid, cwd, force = false) {
  let st;
  try { st = JSON.parse(readFileSync(snapPath(sid), "utf8")); } catch { return undefined; }
  rmSync(snapPath(sid), { force: true });
  const root = st.cwd || cwd;
  const before = new Map(Object.entries(st.files)); before.capped = !!st.capped;
  const after = snapshot(root);
  const changes = diffSnapshots(before, after);
  let tests;
  try { const t = JSON.parse(readFileSync(testsPath(root), "utf8")); if (t.ts >= st.ts) tests = !!t.ok; } catch { /* none ran */ }
  const capped = before.capped || !!after.capped;
  if (!changes.length && !force) return undefined;
  const text = formatAuto(changes, tests, capped);
  try { appendFileSync(join(traceDir(), `hook-${safe(sid)}.jsonl`), JSON.stringify({ t: new Date().toISOString(), type: "report", text }) + "\n"); } catch { /* ignore */ }
  return text;
}
