import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { CAPS, cutNamed, navCall, withHints } from "./common.ts";

/** `dataFlow`: where an attribute or module global is written and read. */
export function makeDataFlow(sc?: Sidecar): ToolDef {
  return {
    name: "dataFlow",
    description: "Where an attribute (path#Class.attr) or module global (path#NAME) is written and read, with locations. Flags writes in thread, executor, asyncio-task or async code.",
    parameters: objectSchema({ symbol: { type: "string", description: "path#Class.attr or path#GLOBAL_NAME." } }, ["symbol"]),
    returns: "{ symbol; writes: { path; line; col; in; kind; approx?; context? }[]; reads: { path; line; col; in; kind; approx? }[]; concurrentWrites: number; truncated?: string }",
    meta: {
      whenToUse: "Track who changes a field or global, and spot writes that may race with other threads or tasks.",
      whenNotToUse: "Not for function calls (use callGraph) or every textual mention (use findReferences).",
      examples: ["writes to app/store.py#Store.count", "who reads app/config.py#DEBUG"],
      category: "graph",
      effect: "read",
      requires: [],
      cost: 3,
    },
    async fn(args: Record<string, unknown>, ctx) {
      const r = await navCall(sc, "dataFlow", args, ctx);
      const hints: string[] = [];
      return withHints({
        symbol: r.symbol,
        writes: cutNamed("writes", r.writes, CAPS.hits, "use findReferences with a path", hints),
        reads: cutNamed("reads", r.reads, CAPS.hits, "use findReferences with a path", hints),
        concurrentWrites: r.concurrentWrites,
      }, hints);
    },
  };
}
