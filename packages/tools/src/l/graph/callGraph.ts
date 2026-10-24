import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { CAPS, cutNamed, navCall, withHints } from "./common.ts";

/** `callGraph`: callers and/or callees of a symbol to a depth, as nodes and edges. */
export function makeCallGraph(sc?: Sidecar): ToolDef {
  return {
    name: "callGraph",
    description: "Callers (in), callees (out) or both of a function, method or class to a depth (default 2, max 5). Nodes by distance plus call edges with line.",
    parameters: objectSchema({
      symbol: { type: "string", description: "Symbol as path#Name or path#Class.method." },
      direction: { type: "string", description: "in (callers), out (callees) or both (default).", enum: ["in", "out", "both"] },
      depth: { type: "integer", description: "Hops to follow, 1-5 (default 2)." },
    }, ["symbol"]),
    returns: "{ symbol; direction; depth; nodes: { symbol; depth; kind; dir? }[]; edges: { from; to; line; approx?; spawn? }[]; truncated?: string }",
    meta: {
      whenToUse: "Trace who calls a function or what it calls across files without reading each one.",
      whenNotToUse: "Not for every textual usage (use findReferences) or for what a change breaks (use impact).",
      examples: ["who calls pkg/db.py#Conn.exec, 3 levels up", "callees of app/core.py#run"],
      category: "graph",
      effect: "read",
      requires: [],
      cost: 2,
    },
    async fn(args: Record<string, unknown>, ctx) {
      const r = await navCall(sc, "callGraph", args, ctx);
      const hints: string[] = [];
      const nodes = cutNamed("nodes", r.nodes as { symbol: string }[], CAPS.nodes, "lower depth or pick direction", hints);
      const keep = new Set(nodes.map((n) => n.symbol));
      const near = (s: string) => s === r.symbol || s.startsWith(`${r.symbol}.__init__`) || keep.has(s);
      const edges = cutNamed("edges", (r.edges as { from: string; to: string }[]).filter((e) => near(e.from) && near(e.to)), CAPS.edges, "lower depth", hints);
      return withHints({ symbol: r.symbol, direction: r.direction, depth: r.depth, nodes, edges }, hints);
    },
  };
}
