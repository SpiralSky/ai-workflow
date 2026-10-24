// Branch program parsing: model-written TS body → callable async function.
import { stripTypeScriptTypes } from "node:module";

/** A function callable from branch code as `tools.<name>(...)`; may be sync or async. */
export type Tool = (...args: any[]) => unknown;

/** Named tools passed to branch code through its `tools` parameter. */
export type Tools = Record<string, Tool>;

/** A compiled branch program: takes the tools and resolves to the body's return value. */
export type BranchFn = (tools: Tools) => Promise<unknown>;

/** `//# sourceURL` name that makes V8 label stack frames from branch code. */
export const BRANCH_SOURCE_URL = "branch-code";

/**
 * Compiles a model-written TypeScript function body into a callable async function.
 *
 * The body is wrapped in `async (tools) => { ... }`, so top-level `await` and `return` work,
 * and the body calls tools as `tools.<name>(...)`.
 * Type annotations are then stripped. The code is not run until the returned function
 * is called. It runs in strict mode in global scope: it can see globals but not this
 * module's locals.
 *
 * @param code - Statements forming the function body, not a full module.
 * @returns A function that takes the `tools` object and runs the body. Its promise resolves to the body's `return`
 *   value and rejects if the body throws.
 * @throws If `code` has a syntax error, or uses TS-only syntax that strip mode can't
 *   erase (e.g. `enum`, `namespace`).
 */
export function parseBranchString(code: string): BranchFn {
  const js = stripTypeScriptTypes(`async (tools) => {\n${code}\n}`, { mode: "strip" });
  // Strict mode: undeclared assignments throw instead of leaking onto globalThis.
  return new Function(`"use strict"; return (${js});\n//# sourceURL=${BRANCH_SOURCE_URL}`)() as BranchFn;
}

/** Result of running a branch program: the returned value, or the failure with its line in the model's code. */
export type BranchResult =
  | { ok: true; value: unknown }
  | { ok: false; error: unknown; message: string; line?: number; aborted?: true };

/**
 * Maps the model's code line N to V8 stack line N + LINE_OFFSET: `new Function` adds 2 header
 * lines ("function anonymous(\n) {\n") and the `async (tools) => {` wrapper adds 1.
 * Strip mode preserves positions, so no other shift occurs.
 */
export const LINE_OFFSET = 3;

/**
 * Finds the 1-based line in the model's code where an error passed through branch code.
 *
 * @param e - The thrown value.
 * @returns The line of the first branch-code stack frame, or undefined if there is no stack or no such frame.
 */
export function errorLine(e: unknown): number | undefined {
  const stack = (e as { stack?: unknown } | null | undefined)?.stack;
  if (typeof stack !== "string") return undefined;
  const frame = stack.split("\n").find((l) => l.includes(`${BRANCH_SOURCE_URL}:`));
  const m = frame?.match(/:(\d+):\d+/);
  if (!m) return undefined;
  const line = Number(m[1]) - LINE_OFFSET;
  return line >= 1 ? line : undefined;
}

/**
 * Options for {@link runBranch}.
 */
export interface RunOptions {
  /**
   * When this signal aborts, runBranch stops waiting and returns an aborted result.
   * For timeouts, pass `AbortSignal.timeout(ms)`. Tools that need to cancel work
   * (e.g. kill child processes) should receive the same signal when the tool set is built
   * (closure); core does not pass it per call.
   */
  signal?: AbortSignal;
}

/**
 * Runs a compiled branch program and captures failure instead of throwing.
 *
 * If `opts.signal` aborts, the run stops being awaited and an aborted result is returned
 * (`aborted: true`, no `line`). Limitation: synchronous code (e.g. `while (true) {}`) blocks
 * the event loop and cannot be interrupted, since branch code runs in-process without a worker.
 *
 * @param fn - The compiled branch program.
 * @param tools - Tools passed to the program.
 * @param opts - Run options, e.g. an abort signal.
 * @returns `{ ok: true, value }` on success, otherwise `{ ok: false, error, message, line?, aborted? }`. Never throws.
 */
export async function runBranch(fn: BranchFn, tools: Tools, opts: RunOptions = {}): Promise<BranchResult> {
  const signal = opts.signal;
  const abortResult = (): BranchResult => {
    const reason: any = signal!.reason;
    return { ok: false, aborted: true, error: reason, message: `aborted: ${String(reason?.message ?? reason)}` };
  };
  if (signal?.aborted) return abortResult();
  let onAbort: (() => void) | undefined;
  // Ref'd timer: AbortSignal.timeout() doesn't keep the process alive, so without this a
  // branch stuck on a never-settling promise lets Node exit before the abort fires.
  let keepAlive: NodeJS.Timeout | undefined;
  try {
    const run = fn(tools);
    if (!signal) return { ok: true, value: await run };
    keepAlive = setInterval(() => {}, 1 << 30);
    const aborted = new Promise<typeof ABORTED>((resolve) => {
      onAbort = () => resolve(ABORTED);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    // If abort wins, run may still reject later; swallow so it is never unhandled.
    run.catch(() => {});
    const winner = await Promise.race([run, aborted]);
    if (winner === ABORTED) return abortResult();
    return { ok: true, value: winner };
  } catch (e) {
    return { ok: false, error: e, message: String((e as any)?.message ?? e), line: errorLine(e) };
  } finally {
    clearInterval(keepAlive);
    if (onAbort) signal!.removeEventListener("abort", onAbort);
  }
}

/** Sentinel resolved by the abort promise in runBranch. */
const ABORTED = Symbol("aborted");
