import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { CAPS, cutNamed, navCall, withHints } from "./common.ts";

/** `impact`: what a change to a symbol could affect. */
export function makeImpact(sc?: Sidecar): ToolDef {
  return {
    name: "impact",
    description: "What changing a symbol could break: transitive callers, subclasses or overriding methods, and the tests (files under tests/ or test_*.py) that reach it.",
    parameters: objectSchema({
      symbol: { type: "string", description: "Symbol as path#Name or path#Class.method." },
      depth: { type: "integer", description: "Caller hops to follow, 1-8 (default 4)." },
    }, ["symbol"]),
    returns: "{ symbol; callers: { symbol; depth; line; approx? }[]; subclasses: string[]; overrides: string[]; tests: { path; via: call|import; symbol?; depth? }[]; truncated?: string }",
    meta: {
      whenToUse: "Before editing shared code: find what depends on it and which tests to run.",
      whenNotToUse: "Not for the direct callers only (use callGraph) or plain text usages (use findReferences).",
      examples: ["impact of changing app/store.py#Store.save", "which tests cover app/core.py#run"],
      category: "graph",
      effect: "read",
      requires: [],
      cost: 3,
    },
    async fn(args: Record<string, unknown>, ctx) {
      const r = await navCall(sc, "impact", args, ctx);
      const hints: string[] = [];
      return withHints({
        symbol: r.symbol,
        callers: cutNamed("callers", r.callers, CAPS.callers, "lower depth or use callGraph", hints),
        subclasses: cutNamed("subclasses", r.subclasses, CAPS.related, "use findReferences", hints),
        overrides: cutNamed("overrides", r.overrides, CAPS.related, "use findReferences", hints),
        tests: cutNamed("tests", r.tests, CAPS.tests, "lower depth", hints),
      }, hints);
    },
  };
}
