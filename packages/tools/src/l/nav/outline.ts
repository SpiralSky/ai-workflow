import { cutList } from "../../search.ts";
import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { MAX_ITEMS, navCall } from "./common.ts";

/** `outline`: symbols of a file without bodies (Python), headings (Markdown) or top-level keys (JSON/YAML). */
export function makeOutline(sc?: Sidecar): ToolDef {
  return {
    name: "outline",
    description: "List a file's symbols with signatures and line ranges, no bodies. Python: classes, functions, methods, constants. Markdown: headings. JSON/YAML: top-level keys.",
    parameters: objectSchema({ path: { type: "string", description: "File path, relative to the workspace root." } }, ["path"]),
    returns: "{ path: string; items: { kind: string; symbol: string; signature: string; line: number; endLine?: number }[]; truncated?: string }",
    meta: {
      whenToUse: "See the shape of a file (what it defines, where) before reading parts of it.",
      whenNotToUse: "Not for the code itself (use readSymbol or readFile) or for finding a name across files (use grep).",
      examples: ["outline src/app/models.py", "list the headings of README.md"],
      category: "nav",
      effect: "read",
      requires: [],
      cost: 2,
    },
    async fn(args: { path: string }, ctx) {
      const res = await navCall(sc, "outline", args, ctx);
      const { kept, truncated } = cutList<unknown>(res.items, MAX_ITEMS * 2, "use readSymbol on a class, or grep");
      return truncated ? { path: res.path, items: kept, truncated } : { path: res.path, items: kept };
    },
  };
}
