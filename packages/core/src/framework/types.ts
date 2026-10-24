import type { LLMClient, Reporter, TranscriptWriter } from "@aiw/telemetry";
import type { IsolateRuntime } from "../branch/isolate.ts";
import type { State, TraceEvent } from "../branch/types.ts";
import type { Host } from "../host/types.ts";
import type { CodeReader } from "../refs/index.ts";
import type { JSONSchema } from "../registry/types.ts";
import type { Selector } from "../orchestrate/selection/index.ts";
import type { Task } from "../orchestrate/task.ts";

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
  /** The orchestrate session (store, tracker, lock); undefined for other frameworks. */
  task?: Task;
}

/** Orchestrate settings (orchestrate-engine §2-§5). */
export interface OrchestrateOptions {
  /** Unwrapped client for the executor and the LLM reranker. */
  client: LLMClient;
  /** Executor model (default = main model, arch §5.3). */
  model: string;
  temperature?: number;
  transcript?: TranscriptWriter;
  /** Workspace root for change tracking and, by default, reading code references. */
  workspaceRoot: string;
  /** Rerank stage: `llm` (default) or `none` (ablation). */
  rerank?: "llm" | "none";
  /** Model of the LLM reranker; default = `model`. */
  rerankModel?: string;
  /** Reads current code for references; default reads files under `workspaceRoot`. */
  reader?: CodeReader;
  /** Checks `@path` references; default stats files under `workspaceRoot`. */
  pathExists?: (path: string) => Promise<boolean>;
  /** Executor turn cap (default 4). */
  turns?: number;
  reportMaxChars?: number;
  /** Reuse an existing session instead of creating one. */
  task?: Task;
  /** Replace the selection pipeline (tests). */
  selector?: Selector;
}

export interface BuildOptions {
  /** Already checked/composed by the caller. */
  host: Host;
  /** Variant keys: `branch-only[toolSearch]`, `catalog=N` (any framework), `orchestrate[hotPaths]`, `orchestrate[executor=calls]`. */
  variant?: { toolSearch?: boolean; catalog?: number; hotPaths?: boolean; executor?: "branch" | "calls" };
  /** Required for `orchestrate`. */
  orchestrate?: OrchestrateOptions;
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
