// Branch runner: executes a model-written TS/JS program in a node:vm context.
// node:vm is NOT a security boundary — run only in throwaway problem copies.
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { makeHelpers, ReturnUserSignal, type Session } from "./helpers.js";
import { trace } from "./trace.js";

export interface Limits { timeoutMs: number; maxCalls: number; maxLLM: number; maxReturnChars: number }
export const defaultLimits: Limits = { timeoutMs: 180_000, maxCalls: 60, maxLLM: 6, maxReturnChars: 4000 };

export type BranchResult =
  | { kind: "return"; text: string; path: string }
  | { kind: "user"; text: string; path: string }
  | { kind: "error"; text: string; path: string };

const WRAP_OFFSET = 1; // wrapper adds one line before user code

export async function runBranch(code: string, s: Session, limits: Limits = defaultLimits, intent?: string): Promise<BranchResult> {
  const t0 = Date.now();
  const path: string[] = [];
  const signal: { user?: string } = {};
  const helpers = makeHelpers(s, limits, path, signal);
  const fmtPath = () => `[${path.join(" → ") || "no calls"}]`;

  let js: string;
  try {
    js = stripTypeScriptTypes(`(async () => {\n${code}\n})()`, { mode: "strip" }); // wrap first: top-level return is illegal in a module/script
  } catch (e: any) {
    return done({ kind: "error", text: `syntax: ${e.message}`, path: fmtPath() });
  }

  const ctx = vm.createContext({ ...helpers, JSON, Math, Date, RegExp, Promise, console: { log: () => {} } });
  let timer: NodeJS.Timeout | undefined;
  try {
    const script = new vm.Script(js, { filename: "branch.ts" });
    const run = script.runInContext(ctx, { timeout: 2000 }) as Promise<unknown>; // sync-part timeout
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout ${limits.timeoutMs}ms`)), limits.timeoutMs); });
    const value = await Promise.race([run, timeout]);
    if (signal.user !== undefined) return done({ kind: "user", text: signal.user, path: fmtPath() });
    return done({ kind: "return", text: capReturn(value, s, limits), path: fmtPath() });
  } catch (e: any) {
    if (signal.user !== undefined || e instanceof ReturnUserSignal) return done({ kind: "user", text: signal.user ?? e.message, path: fmtPath() });
    const line = /branch\.ts:(\d+)/.exec(e?.stack ?? "")?.[1];
    const lineNo = line ? Number(line) - WRAP_OFFSET : undefined;
    const src = lineNo ? code.split("\n")[lineNo - 1]?.trim() : undefined;
    return done({ kind: "error", text: `${e?.message ?? e}${lineNo ? ` (line ${lineNo}: ${src})` : ""}`, path: fmtPath() });
  } finally {
    clearTimeout(timer);
  }

  function done(r: BranchResult): BranchResult {
    trace(s, { type: "branch", intent, kind: r.kind, path: r.path, ms: Date.now() - t0, chars: r.text.length, code });
    return r;
  }
}

function capReturn(value: unknown, s: Session, limits: Limits): string {
  const text = value === undefined ? "(no return value)" : typeof value === "string" ? value : JSON.stringify(value, null, 1);
  if (text.length <= limits.maxReturnChars) return text;
  const id = `$h${s.handles.size + 1}`;
  s.handles.set(id, text);
  return `${text.slice(0, limits.maxReturnChars)}\n…[truncated ${text.length - limits.maxReturnChars} chars; full value in handle ${id}, use getHandle("${id}")]`;
}
