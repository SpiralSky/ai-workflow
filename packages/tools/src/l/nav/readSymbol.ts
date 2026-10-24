import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { navCall } from "./common.ts";

/** `readSymbol`: source (or only the docstring) of one Python symbol. */
export function makeReadSymbol(sc?: Sidecar): ToolDef {
  return {
    name: "readSymbol",
    description: "Read the source of one Python symbol (path#Name or path#Class.method), including decorators, or just its docstring.",
    parameters: objectSchema(
      {
        symbol: { type: "string", description: "Symbol as path#Name or path#Class.method." },
        docOnly: { type: "boolean", description: "Return only the docstring." },
      },
      ["symbol"],
    ),
    returns: "{ symbol: string; path: string; line: number; endLine: number; source: string; truncated?: string } | { symbol: string; doc: string | null }",
    meta: {
      whenToUse: "Read exactly one function, class or method without the rest of the file.",
      whenNotToUse: "Not for line ranges or non-Python files (use readFile); not for who calls it (use findReferences).",
      examples: ["read src/app/models.py#User.save", "docstring of core/util.py#slugify"],
      category: "nav",
      effect: "read",
      requires: [],
      cost: 1,
    },
    fn: (args: { symbol: string; docOnly?: boolean }, ctx) => navCall(sc, "readSymbol", args, ctx),
  };
}
