import { isolatedVMRuntime, type Isolate, type IsolateRuntime } from "./isolate.ts";
import { RECORDER_SOURCE } from "./recorder.ts";
import type {
  BranchResult, BranchTools, CallCtx, CompiledBranch, ErrorCode, RunOptions, State, TraceEvent,
} from "./types.ts";

export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_MEMORY_MB = 128;

let scriptCounter = 0;

interface Snapshot {
  state: State;
  dropped: string[];
}

/** Timeout clock that can be paused by several holders at once; it runs only while none is active. */
class Deadline {
  private left: number;
  private since = 0;
  private timer: NodeJS.Timeout | undefined;
  private pauses = 0;
  private stopped = false;

  constructor(ms: number, private onExpire: () => void) {
    this.left = ms;
    this.arm();
  }

  private arm(): void {
    this.since = Date.now();
    this.timer = setTimeout(this.onExpire, this.left);
  }

  /** Stops the clock; returns an idempotent resume function. */
  pause(): () => void {
    if (this.pauses++ === 0) {
      clearTimeout(this.timer);
      this.left -= Date.now() - this.since;
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      if (--this.pauses === 0 && !this.stopped) this.arm();
    };
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}

/** Replaces the keys of `state` with those of `snap`: absent keys (deleted or dropped) are deleted. */
function writeBack(state: State, snap: Snapshot): void {
  for (const k of Object.keys(state)) {
    if (!(k in snap.state)) delete state[k];
  }
  Object.assign(state, snap.state);
}

/**
 * Runs a compiled branch program in a fresh isolate and returns its result and trace (core-branch §4).
 * Never throws: every failure, including unexpected host errors, becomes a failed `BranchResult`.
 * @param program compiled, instrumented program
 * @param tools host-side tools, invoked with `(args, ctx)`
 * @param state persistent state; mutated in place on completion, error or kill (see BF §4.4)
 * @param opts timeout, memory limit, abort signal and event callback
 * @param runtime isolate engine (defaults to isolated-vm)
 */
export async function runBranch(
  program: CompiledBranch,
  tools: BranchTools,
  state: State,
  opts: RunOptions = {},
  runtime: IsolateRuntime = isolatedVMRuntime,
): Promise<BranchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const memoryMb = opts.memoryMb ?? DEFAULT_MEMORY_MB;
  const trace: TraceEvent[] = [];
  const startedAt = Date.now();
  const emit = (e: TraceEvent) => {
    trace.push(e);
    try {
      opts.onEvent?.(e);
    } catch {
      // a failing observer must not affect the branch
    }
  };
  const fail = (error: ErrorCode, message: string, extra: object = {}): BranchResult => ({
    ok: false, error, message, ...extra, trace,
  });
  if (opts.signal?.aborted) return fail("aborted", "branch aborted before start", { aborted: true });

  const controller = new AbortController();
  const inflight = new Map<number, number>();
  let snap: Snapshot | undefined;
  let killed: ErrorCode | undefined;
  let resolveKill!: () => void;
  const killP = new Promise<undefined>((r) => (resolveKill = () => r(undefined)));
  let iso: Isolate | undefined;

  // Stops everything: aborts tools, marks in-flight calls, disposes the isolate.
  const kill = (code: ErrorCode) => {
    if (killed) return;
    killed = code;
    controller.abort();
    const now = Date.now();
    for (const [id, start] of inflight) {
      emit({ type: "call", phase: "end", id, ok: false, aborted: true, error: "aborted", ms: now - start, t: now - startedAt });
    }
    inflight.clear();
    try {
      iso?.dispose();
    } catch {
      // already gone
    }
    resolveKill();
  };
  const deadline = new Deadline(timeoutMs, () => kill("timeout"));
  const onAbort = () => kill("aborted");
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  /** Host half of one tool call: runs the tool and returns `{ ok, value | error }` as JSON. */
  const hostCall = async (payload: string): Promise<string> => {
    const req = JSON.parse(payload);
    for (const e of req.events as TraceEvent[]) emit(e);
    snap = { state: req.state, dropped: req.dropped };
    if (killed) return "";
    const resumes = new Set<() => void>();
    const ctx: CallCtx = {
      signal: controller.signal,
      pauseTimeout() {
        const resume = deadline.pause();
        resumes.add(resume);
        return resume;
      },
    };
    inflight.set(req.id, Date.now());
    try {
      const tool = Object.hasOwn(tools, req.name) ? tools[req.name] : undefined;
      if (!tool) throw new Error(`unknown tool: ${req.name}`);
      const value = await tool(req.args, ctx);
      if (killed) return "";
      return JSON.stringify({ ok: true, value });
    } catch (e) {
      const err = e as { name?: unknown; message?: unknown; stack?: unknown } | null;
      const obj = err !== null && typeof err === "object";
      return JSON.stringify({
        ok: false,
        error: {
          name: obj && typeof err.name === "string" ? err.name : "Error",
          message: obj && err.message !== undefined ? String(err.message) : String(e),
          stack: obj && typeof err.stack === "string" ? err.stack : undefined,
        },
      });
    } finally {
      // a tool that forgot to resume must not freeze the clock forever
      for (const r of resumes) r();
      if (!killed) inflight.delete(req.id);
    }
  };

  try {
    iso = runtime.create({ memoryMb });
    iso.bridge({ call: hostCall, flush: (s) => (JSON.parse(s) as TraceEvent[]).forEach(emit) });
    const names = JSON.stringify(Object.keys(tools));
    const stateJSON = JSON.stringify(JSON.stringify(state));
    iso.load(
      `globalThis.__rt = (${RECORDER_SOURCE})(__host, ${names}, ${JSON.stringify(program.lineMap)}, ${stateJSON}, ${startedAt}); delete globalThis.__host;`,
      "recorder.js",
    );
    iso.load(
      `globalThis.__prog = (async function (__t, __tools, __state, console) { const __main = ${program.js}\n; return __main(__tools, __state); })`,
      `branch-code-${++scriptCounter}.js`,
    );
    const runP = iso.run("__rt.run(__prog)");
    runP.catch(() => {});
    let raw: string | undefined;
    try {
      raw = await Promise.race([runP, killP]);
    } catch (e) {
      // not killed by us: the engine disposed itself (heap limit) or the script failed
      if (killed) raw = undefined;
      else if (iso.disposed || /memory limit/i.test(String((e as Error)?.message))) kill("memory");
      else throw e;
    }

    if (killed) {
      const dropped = snap?.dropped.length ? { droppedKeys: snap.dropped } : {};
      if (snap) writeBack(state, snap);
      const msgs: Record<string, string> = {
        timeout: `branch timed out after ${timeoutMs} ms`,
        aborted: "branch aborted",
        memory: `branch exceeded the memory limit (${memoryMb} MB)`,
      };
      return fail(killed, msgs[killed] ?? killed, { aborted: killed !== "memory" || undefined, stateReverted: true, ...dropped });
    }

    const out = JSON.parse(raw as string);
    writeBack(state, { state: out.state, dropped: out.dropped });
    const dropped = out.dropped.length ? { droppedKeys: out.dropped as string[] } : {};
    if (out.ok) return { ok: true, value: out.value, ...dropped, trace };
    return fail("thrown", out.message, { line: out.line, ...dropped });
  } catch (e) {
    if (killed) return fail(killed, killed, { aborted: killed !== "memory" || undefined, stateReverted: true });
    return fail("thrown", `branch runtime error: ${(e as Error)?.message ?? String(e)}`);
  } finally {
    deadline.stop();
    opts.signal?.removeEventListener("abort", onAbort);
    try {
      iso?.dispose();
    } catch {
      // ignore
    }
  }
}
