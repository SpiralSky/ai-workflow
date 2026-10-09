// Change report core, shared by the MCP server (via report.ts) and the hook scripts (plain JS, no build step).
// Flow per turn: UserPromptSubmit hook snapshots the workspace -> Stop hook (or the returnUser PostToolUse hook) diffs it.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", "__pycache__", ".branch-traces"]);
const MAX_FILE = 200 * 1024;
const MAX_FILES = 5000;

/** @returns {Map<string,string>} relative path -> text content */
export function snapshot(cwd) {
  const snap = new Map();
  const walk = (rel) => {
    let ents;
    try { ents = readdirSync(join(cwd, rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (snap.size >= MAX_FILES) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(r); }
      else if (e.isFile()) {
        try {
          const abs = join(cwd, r);
          if (statSync(abs).size > MAX_FILE) continue;
          const txt = readFileSync(abs, "utf8");
          if (!txt.includes("\0")) snap.set(r, txt);
        } catch { /* unreadable: ignore */ }
      }
    }
  };
  walk("");
  return snap;
}

const lines = (s) => (s === "" ? [] : s.replace(/\n$/, "").split("\n"));

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
    out.push({ path, ...lineDiff(a ?? "", b ?? "") });
  }
  return out;
}

export function formatAuto(changes, tests) {
  if (!changes.length) return "No file changes.";
  const files = changes.map((c) => `${c.path} (+${c.added} −${c.deleted})`).join(", ");
  return `Changes: ${files}${tests === undefined ? "" : ` · tests: ${tests ? "ok" : "fail"}`}`;
}

// ---- per-turn state (shared via files: hooks and the MCP server are separate processes)
export const traceDir = () => process.env.BRANCH_TRACE_DIR ?? join(tmpdir(), "branch-traces");
const stateDir = () => join(traceDir(), "state");
const safe = (s) => String(s ?? "x").replace(/[^\w.-]/g, "_");
const snapPath = (sid) => join(stateDir(), `snap-${safe(sid)}.json`);
const testsPath = (cwd) => join(stateDir(), `tests-${createHash("sha1").update(resolve(cwd)).digest("hex").slice(0, 12)}.json`);

/** Called by the server after a branch ran runTests: latest result for this workspace. */
export function recordTests(cwd, ok) {
  try { mkdirSync(stateDir(), { recursive: true }); writeFileSync(testsPath(cwd), JSON.stringify({ ts: Date.now(), ok })); } catch { /* best effort */ }
}

/** UserPromptSubmit: remember the workspace as it is before this turn's work. */
export function saveSnapshot(sid, cwd) {
  try {
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(snapPath(sid), JSON.stringify({ ts: Date.now(), cwd, reported: false, files: Object.fromEntries(snapshot(cwd)) }));
  } catch { /* best effort */ }
}

/**
 * Diff the workspace against this turn's snapshot, once per turn. Returns undefined when there is no snapshot or the
 * report was already delivered this turn (so the Stop hook stays silent after the returnUser hook reported).
 * `force` keeps an empty diff ("No file changes."); otherwise empty turns produce no report.
 */
export function takeReport(sid, cwd, force = false) {
  let st;
  try { st = JSON.parse(readFileSync(snapPath(sid), "utf8")); } catch { return undefined; }
  if (st.reported) return undefined;
  const changes = diffSnapshots(new Map(Object.entries(st.files)), snapshot(cwd));
  let tests;
  try { const t = JSON.parse(readFileSync(testsPath(cwd), "utf8")); if (t.ts >= st.ts) tests = !!t.ok; } catch { /* none ran */ }
  try { writeFileSync(snapPath(sid), JSON.stringify({ ...st, files: {}, reported: true })); rmSync(testsPath(cwd), { force: true }); } catch { /* ignore */ }
  if (!changes.length && !force) return undefined;
  const text = formatAuto(changes, tests);
  try { appendFileSync(join(traceDir(), `hook-${safe(sid)}.jsonl`), JSON.stringify({ t: new Date().toISOString(), type: "report", text }) + "\n"); } catch { /* ignore */ }
  return text;
}
