import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { CHANGE_RETURNS, DRY_RUN, refactorCall } from "./common.ts";

/** `moveModule`: move or rename a module file or package and rewrite every import of it (rope). */
export function makeMoveModule(sc?: Sidecar): ToolDef {
  return {
    name: "moveModule",
    description: "Move or rename a module (.py file) or package (directory with __init__.py) and rewrite every import of it. Change the directory or the name per call, not both.",
    parameters: objectSchema({
      from: { type: "string", description: "Existing module file or package directory." },
      to: { type: "string", description: "New path of the module or package." },
      dryRun: DRY_RUN,
    }, ["from", "to"]),
    returns: `{ ${CHANGE_RETURNS} }`,
    meta: {
      whenToUse: "Rename or relocate a Python module or package and keep every import working.",
      whenNotToUse: "Not for non-Python files or files nobody imports (use moveFile, which does not fix imports); not for one symbol (use moveSymbol).",
      examples: ["rename pkg/util.py to pkg/helpers.py", "move package pkg/old to lib/old"],
      category: "refactor",
      effect: "write",
      requires: [],
      cost: 3,
    },
    fn: (args: Record<string, unknown>, ctx) => refactorCall(sc, "moveModule", args, ctx),
  };
}
