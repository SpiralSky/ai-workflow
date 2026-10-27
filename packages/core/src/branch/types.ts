/** Plain JSON object that persists across branch calls (BF §4.4). */
export type State = Record<string, unknown>;

/** Per-inner-call context built by `runBranch` (core-branch §4, A-23). */
export interface CallCtx {
  /** Aborts on `opts.signal` abort or branch timeout. */
  signal: AbortSignal;
  /** Pauses the branch timeout clock; returns the resume function. */
  pauseTimeout(): () => void;
}

/**
 * Host-side tool: one argument object plus the per-call ctx. The model-facing call takes only the
 * argument (BF §6.1); the bridge adds `ctx`. Failures throw.
 */
export type BranchTool = (args: Record<string, unknown>, ctx: CallCtx) => unknown;
export type BranchTools = Record<string, BranchTool>;

export type CondKind = "if" | "ternary" | "switch" | "catch";
export type LoopKind = "for" | "for-of" | "for-in" | "while" | "do";
export type ErrorCode = "compile" | "thrown" | "timeout" | "memory" | "aborted";

/**
 * One trace event (BF §7.1). `t` is ms since branch start. Lines are original program lines.
 * A `call` is recorded as a `start` event and a matching `end` event (same `id`), so concurrent
 * calls and in-flight calls at a kill are representable; renderers merge the pair.
 */
export type TraceEvent =
  | { type: "call"; phase: "start"; id: number; line: number; name: string; args: unknown; t: number }
  | {
      type: "call"; phase: "end"; id: number; ok: boolean; t: number; ms: number;
      result?: unknown; error?: string; aborted?: boolean;
    }
  /** `pos`/`end`: source offsets of the condition (if/ternary), case clause (switch) or catch clause. */
  | { type: "cond"; line: number; kind: CondKind; value: unknown; pos: number; end: number; t: number }
  | { type: "loop"; phase: "enter"; line: number; kind: LoopKind; endLine: number; t: number }
  | { type: "loop"; phase: "iter" | "exit"; line: number; t: number }
  | { type: "log"; line: number; level: "log" | "info" | "warn" | "error"; message: string; t: number }
  | { type: "return"; line: number; value: unknown; t: number }
  | { type: "error"; message: string; lines: number[]; tool?: string; callId?: number; t: number };

interface ResultBase {
  trace: TraceEvent[];
}
export interface BranchOk extends ResultBase {
  ok: true;
  value: unknown;
  /** Keys dropped from `state` write-back because they were not JSON-serialisable. */
  droppedKeys?: string[];
}
export interface BranchFail extends ResultBase {
  ok: false;
  error: ErrorCode;
  message: string;
  line?: number;
  aborted?: boolean;
  stateReverted?: boolean;
  droppedKeys?: string[];
}
/** BF §5.1. */
export type BranchResult = BranchOk | BranchFail;

/** Output of `compileBranch`. `lineMap[i]` is the original line of emitted JS line `i + 1`. */
export interface CompiledBranch {
  js: string;
  lineMap: number[];
}
export interface CompileError {
  error: "compile";
  message: string;
  line?: number;
}

export interface TraceLimits {
  /** Max chars of a rendered value (default 200). */
  valueChars: number;
  /** Loops with more iterations than this are collapsed (default 3). */
  loopCollapse: number;
  /** Max rendered events (default 60); the final return/error is always kept. */
  eventBudget: number;
}
export const DEFAULT_TRACE_LIMITS: TraceLimits = { valueChars: 2000, loopCollapse: 3, eventBudget: 60 };

export interface RunOptions {
  signal?: AbortSignal;
  onEvent?: (e: TraceEvent) => void;
  /** Default 120 000 (A-23). */
  timeoutMs?: number;
  /** Default 128. */
  memoryMb?: number;
}
