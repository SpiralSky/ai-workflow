import type { Reporter } from "@aiw/telemetry";
import type { IsolateRuntime } from "../branch/isolate.ts";
import type { State, TraceEvent } from "../branch/types.ts";
import type { Host } from "../host/types.ts";
import type { JSONSchema } from "../registry/types.ts";

export type FrameworkKind = "baseline" | "branch-only" | "orchestrate";

/** Per-call context supplied by the runner or server. */
export interface FrameworkCall {
  reporter: Reporter;
  signal?: AbortSignal;
  onEvent?: (e: TraceEvent) => void;
}

/** Model-facing result of one framework tool call. */
export interface FrameworkResult {
  text: string;
  isError: boolean;
}

/** A tool the model sees directly. */
export interface FrameworkTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  handle(args: Record<string, unknown>, call: FrameworkCall): Promise<FrameworkResult>;
}

/** An assembled framework (core-tools-and-hosts §6). */
export interface Framework {
  kind: FrameworkKind;
  /** Prompt section (MCP instructions); "" for baseline. */
  instructions: string;
  tools: FrameworkTool[];
  /** sha256 hex of the instructions, and of the canonical JSON of the tool list. */
  fingerprint: { promptHash: string; toolsHash: string };
  /** Branch session state ({} for baseline). */
  state: State;
}

export interface BuildOptions {
  /** Already checked/composed by the caller. */
  host: Host;
  variant?: { toolSearch?: boolean; catalog?: number };
  /** Default QuickJS. */
  runtime?: IsolateRuntime;
  /** Render mode, default "trace". */
  branchContext?: "trace" | "annotated" | "full";
  /** Declaration cap and keep-first list (core-tools-and-hosts §6.2). */
  maxChars?: number;
  priority?: string[];
  outputCap?: number;
  timeoutMs?: number;
  memoryMb?: number;
}
