import type { CallCtx } from "../branch/types.ts";
import { normalizeName } from "../registry/normalize.ts";
import type { HostToolDecl } from "../registry/types.ts";
import type { Host, HostCallRequest } from "./types.ts";

/** Presents several hosts as one; routes each call to the host that listed the tool. */
export class CompositeHost implements Host {
  private owner?: Map<string, Host>;

  constructor(private readonly hosts: Host[]) {}

  /**
   * Concatenates the hosts' tools in host order.
   * @throws Error on a duplicate host name or a duplicate normalised name (registration error)
   */
  async tools(): Promise<HostToolDecl[]> {
    const owner = new Map<string, Host>();
    const normalised = new Map<string, string>();
    const out: HostToolDecl[] = [];
    for (const host of this.hosts) {
      for (const d of await host.tools()) {
        if (owner.has(d.name)) throw new Error(`Duplicate tool name "${d.name}" across hosts`);
        const n = normalizeName(d.name);
        const prior = normalised.get(n);
        if (prior !== undefined) throw new Error(`Tool name collision: host tools "${prior}" and "${d.name}" both normalise to "${n}"`);
        normalised.set(n, d.name);
        owner.set(d.name, host);
        out.push(d);
      }
    }
    this.owner = owner;
    return out;
  }

  async call(req: HostCallRequest, ctx: CallCtx): Promise<unknown> {
    if (!this.owner) await this.tools();
    const host = this.owner!.get(req.name);
    if (!host) throw new Error(`unknown tool: ${req.name}`);
    return host.call(req, ctx);
  }

  async close(): Promise<void> {
    const rs = await Promise.allSettled(this.hosts.map((h) => h.close()));
    const bad = rs.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (bad) throw bad.reason;
  }
}
