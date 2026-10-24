import type { CallCtx } from "../branch/types.ts";
import type { Effect, HostToolDecl } from "../registry/types.ts";

/** One inner call as a host receives it (core-tools-and-hosts §4). `name` is the host name. */
export interface HostCallRequest {
  /** Inner-call id = its telemetry event id. */
  id: string;
  /** Event id of the enclosing framework call (`branch` / `do`). */
  parent: string;
  name: string;
  args: unknown;
}

/** Executes tools; implementations live in `@aiw/server` except the core wrappers. */
export interface Host {
  tools(): Promise<HostToolDecl[]>;
  /** Throws on failure or denial; transport failures throw `HostError`. */
  call(req: HostCallRequest, ctx: CallCtx): Promise<unknown>;
  close(): Promise<void>;
}

/** Facts the check step depends on that only the harness knows (harness-integration §6.2). */
export interface SessionContext {
  permissionMode?: string;
  sessionId?: string;
  transcriptPath?: string;
  /** Read-only mode (harness-integration §7.4): calls with effect ≠ `read` are denied. */
  readOnly?: boolean;
}

export interface CheckCall {
  name: string;
  hostName: string;
  args: unknown;
  effect: Effect;
}

export interface CheckDecision {
  decision: "allow" | "deny" | "ask";
  reason?: string;
  /** Modified arguments to call with instead. */
  args?: unknown;
}

/** The check step (framework-server §5). */
export interface Checker {
  check(call: CheckCall, session: SessionContext): Promise<CheckDecision>;
  /** Post-tool hooks; runs after a successful call. */
  after?(call: CheckCall, result: unknown): Promise<void>;
}
