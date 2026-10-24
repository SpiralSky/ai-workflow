import { cutList } from "../../search.ts";
import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { MAX_ITEMS, TARGET_PROPS, navCall } from "./common.ts";

/** `findReferences`: every usage of a symbol in the workspace with a line of context. */
export function makeFindReferences(sc?: Sidecar): ToolDef {
  return {
    name: "findReferences",
    description: "Find every usage of a symbol (calls, imports, annotations, attribute access) with one line of context each. Point at it like findDefinition.",
    parameters: objectSchema(TARGET_PROPS, []),
    returns: "{ references: { path: string; line: number; col: number; context: string; definition?: true }[]; truncated?: string }",
    meta: {
      whenToUse: "Know everything that uses a function, class or variable before changing it.",
      whenNotToUse: "Not for multi-hop questions (who calls the callers): use callGraph. Not for plain text search (use grep).",
      examples: ["usages of User.save", "references to `slugify` in core/util.py"],
      category: "nav",
      effect: "read",
      requires: [],
      cost: 3,
    },
    async fn(args: Record<string, unknown>, ctx) {
      const res = await navCall(sc, "findReferences", args, ctx);
      const { kept, truncated } = cutList<unknown>(res.references, MAX_ITEMS, "point at a more specific symbol or use grep with a path");
      const hint = truncated ?? res.truncated;
      return hint ? { references: kept, truncated: hint } : { references: kept };
    },
  };
}
