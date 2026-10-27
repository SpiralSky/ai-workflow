import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { CHANGE_RETURNS, DRY_RUN, refactorCall } from "./common.ts";

/** `replaceSymbol`: replace the entire body of a named Python symbol by address. */
export function makeReplaceSymbol(sc?: Sidecar): ToolDef {
  return {
    name: "replaceSymbol",
    description:
      "Replace the entire body of a named Python symbol (function, method, or class) by address, without needing to know the current content.",
    parameters: objectSchema(
      {
        symbol: { type: "string", description: "Symbol address as path#Name or path#Class.method." },
        content: {
          type: "string",
          description: "Replacement (signature + body), already indented to the correct scope level.",
        },
        dryRun: DRY_RUN,
      },
      ["symbol", "content"],
    ),
    returns: `{ ${CHANGE_RETURNS} }`,
    meta: {
      whenToUse:
        "Replace the full body of a Python function, method or class when you have the new implementation but do not need to know the existing one.",
      whenNotToUse:
        "Not for partial edits (use edit), renaming (use renameSymbol), or non-Python files.",
      examples: [
        "replace pkg/util.py#slugify with a new implementation",
        "replace pkg/models.py#User.save with an async version",
      ],
      category: "refactor",
      effect: "write",
      requires: [],
      cost: 2,
    },
    fn: (args: Record<string, unknown>, ctx) => refactorCall(sc, "replaceSymbol", args, ctx),
  };
}
