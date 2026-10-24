import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { TARGET_PROPS } from "../nav/common.ts";
import { CHANGE_RETURNS, DRY_RUN, refactorCall } from "./common.ts";

/** `inlineSymbol`: replace calls to a function, or uses of a variable, with its body or value, then remove it (rope). */
export function makeInlineSymbol(sc?: Sidecar): ToolDef {
  return {
    name: "inlineSymbol",
    description: "Replace every call of a function (or use of a variable) with its body (or value) and remove the definition. Fails when the substitution could change behaviour.",
    parameters: objectSchema({ ...TARGET_PROPS, dryRun: DRY_RUN }, []),
    returns: `{ ${CHANGE_RETURNS} }`,
    meta: {
      whenToUse: "Remove a needless indirection: a one-expression function or a variable used a few times.",
      whenNotToUse: "Not for multi-statement functions or functions passed around as values; edit the callers by hand instead.",
      examples: ["inline pkg/util.py#shout", "inline variable k on line 2 of pkg/calc.py"],
      category: "refactor",
      effect: "write",
      requires: [],
      cost: 3,
    },
    fn: (args: Record<string, unknown>, ctx) => refactorCall(sc, "inlineSymbol", args, ctx),
  };
}
