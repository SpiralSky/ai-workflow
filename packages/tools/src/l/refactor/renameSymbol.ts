import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { TARGET_PROPS } from "../nav/common.ts";
import { CHANGE_RETURNS, DRY_RUN, refactorCall } from "./common.ts";

/** `renameSymbol`: rename a function, class, method, variable, parameter or attribute everywhere (rope). */
export function makeRenameSymbol(sc?: Sidecar): ToolDef {
  return {
    name: "renameSymbol",
    description: "Rename a function, class, method, variable, parameter or attribute and update every reference and import. Point at it with symbol, or path plus name/line/col.",
    parameters: objectSchema({
      ...TARGET_PROPS,
      newName: { type: "string", description: "The new identifier." },
      dryRun: DRY_RUN,
    }, ["newName"]),
    returns: `{ ${CHANGE_RETURNS}; unsure?: { path: string; line: number }[] }`,
    meta: {
      whenToUse: "Rename a Python name across the whole workspace, including imports and keyword arguments. Overriding methods are renamed with the method.",
      whenNotToUse: "Not for renaming text in strings, comments or non-Python files, or a one-off change (use edit). Not for module files (use moveModule).",
      examples: ["rename pkg/util.py#slugify to make_slug", "rename parameter sep to separator on line 3 of pkg/util.py"],
      category: "refactor",
      effect: "write",
      requires: [],
      cost: 3,
    },
    fn: (args: Record<string, unknown>, ctx) => refactorCall(sc, "renameSymbol", args, ctx),
  };
}
