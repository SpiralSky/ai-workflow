import type { CallCtx } from "../branch/types.ts";
import { normalizeName } from "../registry/normalize.ts";
import type { Effect, HostToolDecl } from "../registry/types.ts";
import type { CheckCall, Checker, Host, HostCallRequest, SessionContext } from "./types.ts";

export interface CheckedHostOptions {
  /** Read at every call (the harness context can change between calls). */
  session: () => SessionContext;
  /** Resolves an `ask` decision; without it `ask` is denied. */
  approve?: (call: CheckCall, reason?: string) => Promise<boolean>;
}

/** Wraps a host with the check step and read-only mode (framework-server §5). */
export class CheckedHost implements Host {
  private effects?: Map<string, Effect>;

  constructor(
    private readonly inner: Host,
    private readonly checker: Checker,
    private readonly opts: CheckedHostOptions,
  ) {}

  /** Passes the inner listing through, caching each tool's effect (default `write`). */
  async tools(): Promise<HostToolDecl[]> {
    const decls = await this.inner.tools();
    this.effects = new Map(decls.map((d) => [d.name, d.meta?.effect ?? "write"]));
    return decls;
  }

  /**
   * Checks, optionally asks for approval, then calls the inner host.
   * @throws Error `denied: <reason>` when read-only mode, the checker or the user refuses
   */
  async call(req: HostCallRequest, ctx: CallCtx): Promise<unknown> {
    if (!this.effects) await this.tools();
    const call: CheckCall = {
      name: normalizeName(req.name),
      hostName: req.name,
      args: req.args,
      effect: this.effects!.get(req.name) ?? "write",
    };
    const session = this.opts.session();
    if (session.readOnly && call.effect !== "read") throw new Error("denied: read-only mode");
    const d = await this.checker.check(call, session);
    if (d.decision === "deny") throw new Error(`denied: ${d.reason ?? "policy"}`);
    if (d.decision === "ask") {
      if (!this.opts.approve) throw new Error("denied: no approval channel");
      const resume = ctx.pauseTimeout();
      let ok: boolean;
      try {
        ok = await this.opts.approve(call, d.reason);
      } finally {
        resume();
      }
      if (!ok) throw new Error("denied: declined by user");
    }
    const result = await this.inner.call({ ...req, args: d.args ?? req.args }, ctx);
    await this.checker.after?.(call, result);
    return result;
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}
