import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { CAPS, cutNamed, navCall, withHints } from "./common.ts";

/** `importGraph`: module import edges with import cycles and the line that closes each. */
export function makeImportGraph(sc?: Sidecar): ToolDef {
  return {
    name: "importGraph",
    description: "Module import edges (who imports whom, with line) for a module, a package or the whole workspace, plus import cycles and the import line that closes each.",
    parameters: objectSchema({ module: { type: "string", description: "Dotted name, file path or package dir; omit for everything." } }, []),
    returns: "{ module: string|null; edges: { from: path; to: path; line; lazy? }[]; cycles: { modules: path[]; closedBy: { path; line } }[]; truncated?: string }",
    meta: {
      whenToUse: "See module dependencies or find the import that creates a circular import.",
      whenNotToUse: "Not for symbol-level calls (use callGraph). Imports inside functions or TYPE_CHECKING are marked lazy and ignored by cycles.",
      examples: ["import cycles in this repo", "what imports pkg.models"],
      category: "graph",
      effect: "read",
      requires: [],
      cost: 2,
    },
    async fn(args: { module?: string }, ctx) {
      const r = await navCall(sc, "importGraph", args, ctx);
      const hints: string[] = [];
      // cycles first: they are the point of the tool
      const cycles = cutNamed("cycles", r.cycles, CAPS.cycles, "pass module to narrow", hints);
      const edges = cutNamed("edges", r.edges, CAPS.importEdges, "pass module (dotted name or package dir) to narrow", hints);
      return withHints({ module: r.module, edges, cycles }, hints);
    },
  };
}
