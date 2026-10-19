// Branch runner: executes a model-written TS/JS program in a worker thread (node:vm context).
// node:vm is NOT a security boundary — run only in throwaway problem copies.
import { Worker } from "node:worker_threads";
import { stripTypeScriptTypes } from "node:module";
import { makeHelpers, makeFilteredHelpers, newCtl, stopAll, type Session } from "./helpers.js";
import { trace } from "./trace.js";

export interface Limits { timeoutMs: number; maxCalls: number; maxLLM: number; maxReturnChars: number }
export const defaultLimits: Limits = { timeoutMs: 180_000, maxCalls: 60, maxLLM: 6, maxReturnChars: 4000 };

export type BranchResult =
  | { kind: "return"; text: string; path: string }
  | { kind: "user"; text: string; path: string }
  | { kind: "error"; text: string; path: string };

// The program runs in a worker thread (so a timeout can terminate even `await x; while(true){}`);
// helpers run here on the main thread and are called over postMessage. Self-contained: no imports of ours.
// No node:vm sandbox — branch code has full Node.js access. Sandboxing is an environment-level concern.
const WORKER = `
const { parentPort, workerData: { js, names, state, handles } } = require("node:worker_threads");
process.on("unhandledRejection", () => {});
const hs = new Map(handles), pending = new Map();
let seq = 0;
parentPort.on("message", (m) => {
  const p = pending.get(m.id); pending.delete(m.id);
  if (!p) return;
  if (m.ok) return p.res(m.value);
  const e = new Error(m.message); e.stack = "Error: " + m.message + "\\n" + p.site; p.rej(e); // site keeps the branch line
});
const call = (name) => (...args) => new Promise((res, rej) => {
  const id = ++seq, site = (new Error().stack || "").split("\\n").slice(2).join("\\n");
  pending.set(id, { res, rej, site });
  try { parentPort.postMessage({ t: "call", id, name, args }); } catch (e) { pending.delete(id); rej(new Error(name + ": arguments not cloneable")); }
});
const ctx = { state,
  parallel: (...ps) => Promise.all(ps),
  getHandle: (id) => { const v = hs.get(id); if (v === undefined) throw new Error("no handle " + id); return v; },
  returnUser: (m) => { m = String(m); parentPort.postMessage({ t: "user", text: m }); const e = new Error(m); e.name = "ReturnUserSignal"; throw e; } };
for (const n of names) ctx[n] = call(n);
(async () => {
  let msg;
  try {
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const value = await new AsyncFunction(...Object.keys(ctx), "return (" + js + ")")(...Object.values(ctx));
    let text;
    try { text = typeof value === "string" ? value : JSON.stringify(value, null, 1); } catch { /* circular, BigInt */ }
    if (text === undefined && value !== undefined) { try { text = String(value); } catch { text = "[unserializable]"; } }
    msg = { t: "done", ok: true, text };
  } catch (e) {
    msg = { t: "done", ok: false, message: String(e && e.message !== undefined ? e.message : e), stack: String((e && e.stack) || ""), user: !!e && e.name === "ReturnUserSignal" };
  }
  try { msg.state = state; parentPort.postMessage(msg); } catch { msg.state = undefined; parentPort.postMessage(msg); }
})();
`;

type Outcome =
  | { t: "done"; ok: true; text?: string; state?: Record<string, unknown> }
  | { t: "done"; ok: false; message: string; stack: string; user: boolean; state?: Record<string, unknown> }
  | { t: "timeout" } | { t: "crash"; message: string };

export async function runBranch(code: string, s: Session, limits: Limits = defaultLimits, intent?: string, allowed?: Set<string>): Promise<BranchResult> {
  const t0 = Date.now();
  const path: string[] = [];
  const signal: { user?: string } = {};
  const ctl = newCtl();
  const helpers: Record<string, any> = allowed
    ? makeFilteredHelpers(s, limits, path, signal, ctl, allowed)
    : makeHelpers(s, limits, path, signal, ctl);
  const fmtPath = () => `[${path.join(" → ") || "no calls"}]`;

  let js: string;
  try {
    // Wrap in IIFE so top-level return and await are valid; stripTypeScriptTypes treats naked code as a script where return is illegal
    js = stripTypeScriptTypes(`(async () => {\n${code}\n})()`, { mode: "strip" });
  } catch (e: any) {
    return done({ kind: "error", text: `syntax: ${e.message}`, path: fmtPath() });
  }

  const local = new Set(["state", "parallel", "getHandle", "returnUser"]);
  const names = Object.keys(helpers).filter((n) => !local.has(n));
  let worker: Worker | undefined, timer: NodeJS.Timeout | undefined;
  try {
    let o: Outcome;
    try {
      worker = new Worker(WORKER, { eval: true, workerData: { js, names, state: s.state, handles: [...s.handles] } });
    } catch (e: any) {
      return done({ kind: "error", text: `state must be structured-cloneable: ${e?.message ?? e}`, path: fmtPath() });
    }
    const w = worker;
    o = await new Promise<Outcome>((resolve) => {
      timer = setTimeout(() => resolve({ t: "timeout" }), limits.timeoutMs);
      w.on("error", (e: any) => resolve({ t: "crash", message: String(e?.message ?? e) }));
      w.on("exit", () => resolve({ t: "crash", message: "worker exited unexpectedly" }));
      w.on("message", (m: any) => {
        if (ctl.finished) return;
        if (m.t === "done") return resolve(m);
        if (m.t === "user") { signal.user = m.text; path.push("returnUser"); return; }
        const reply = (r: object) => { try { w.postMessage({ id: m.id, ...r }); } catch (e: any) { w.postMessage({ id: m.id, ok: false, message: `result not cloneable: ${e?.message}` }); } };
        Promise.resolve().then(() => helpers[m.name](...m.args)).then((value) => reply({ ok: true, value }), (e) => reply({ ok: false, message: String(e?.message ?? e) }));
      });
    });
    stopAll(ctl); // from here on helpers refuse to run; in-flight children are killed
    if (o.t === "timeout") return done({ kind: "error", text: `timeout ${limits.timeoutMs}ms`, path: fmtPath() });
    if (o.t === "crash") return done({ kind: "error", text: o.message, path: fmtPath() });
    if (o.state) { for (const k of Object.keys(s.state)) delete s.state[k]; Object.assign(s.state, o.state); }
    if (signal.user !== undefined || (!o.ok && o.user)) return done({ kind: "user", text: signal.user ?? (o.ok ? "" : o.message), path: fmtPath() });
    if (!o.ok) {
      // AsyncFunction header takes 2 lines; IIFE wrapper adds 1 more — stack line N = user line N-3
      const line = /anonymous>?:(\d+)/.exec(o.stack)?.[1] ?? /evalmachine[^:]*:(\d+)/.exec(o.stack)?.[1];
      const lineNo = line ? Number(line) - 3 : undefined;
      const src = lineNo ? code.split("\n")[lineNo - 1]?.trim() : undefined;
      return done({ kind: "error", text: `${o.message}${lineNo ? ` (line ${lineNo}: ${src})` : ""}`, path: fmtPath() });
    }
    if (!o.state) return done({ kind: "error", text: "state must be structured-cloneable (no functions/classes); state changes lost", path: fmtPath() });
    return done({ kind: "return", text: capReturn(o.text, s, limits), path: fmtPath() });
  } finally {
    clearTimeout(timer);
    stopAll(ctl);
    void worker?.terminate();
  }

  function done(r: BranchResult): BranchResult {
    trace(s, { type: "branch", intent, kind: r.kind, path: r.path, ms: Date.now() - t0, chars: r.text.length, code });
    return r;
  }
}

function capReturn(value: string | undefined, s: Session, limits: Limits): string {
  const text = value ?? "(no return value — your code completed without a `return` statement; all helper results were discarded)";
  if (text.length <= limits.maxReturnChars) return text;
  const id = `$h${s.handles.size + 1}`;
  s.handles.set(id, text);
  return `${text.slice(0, limits.maxReturnChars)}\n…[truncated ${text.length - limits.maxReturnChars} chars; full value in handle ${id}, use getHandle("${id}")]`;
}
