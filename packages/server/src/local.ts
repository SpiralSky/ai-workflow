import { type Host, type HostCallRequest, type HostToolDecl } from "@aiw/core";
import { catalog, toHostDecl, type ToolCtx } from "@aiw/tools";
import type { CallCtx } from "@aiw/core";
import type { Sidecar } from "@aiw/tools";
import type { Snapshot } from "@aiw/tools";

/** Options for `LocalHost`. */
export interface LocalHostOpts {
  /** Absolute workspace root; all tool calls are contained to it. */
  root: string;
  /** Startup snapshot for diff/restore tools; without it those tools throw. */
  snapshot?: Snapshot;
  /** Python analysis sidecar for nav/graph/check tools; without it those tools throw. */
  sidecar?: Sidecar;
}

/**
 * Wraps the `@aiw/tools` catalog as a `Host` (framework-server §3).
 * Used by the runner and as the built-in source for MCP fallback.
 */
export class LocalHost implements Host {
  private readonly tier: "S" | "L";
  private readonly opts: LocalHostOpts;

  constructor(tier: "S" | "L", opts: LocalHostOpts) {
    this.tier = tier;
    this.opts = opts;
  }

  /**
   * Returns the catalog tools for this tier as host tool declarations.
   * @returns host tool declarations in catalog order
   */
  async tools(): Promise<HostToolDecl[]> {
    const defs = catalog(this.tier, {
      root: this.opts.root,
      snapshot: this.opts.snapshot,
      sidecar: this.opts.sidecar,
    });
    return defs.map(toHostDecl);
  }

  /**
   * Calls a catalog tool by host name with the provided args.
   * @param req - call request with name and args
   * @param ctx - call context with abort signal
   * @returns the tool result
   * @throws Error when the tool is not found or the tool itself throws
   */
  async call(req: HostCallRequest, ctx: CallCtx): Promise<unknown> {
    const defs = catalog(this.tier, {
      root: this.opts.root,
      snapshot: this.opts.snapshot,
      sidecar: this.opts.sidecar,
    });
    const def = defs.find((d) => d.name === req.name);
    if (!def) throw new Error(`LocalHost: unknown tool "${req.name}"`);
    const toolCtx: ToolCtx = {
      root: this.opts.root,
      signal: ctx.signal,
    };
    const args = typeof req.args === "object" && req.args !== null ? req.args : {};
    return def.fn(args, toolCtx);
  }

  /** No-op: the local catalog has no external connections to close. */
  async close(): Promise<void> {}
}
