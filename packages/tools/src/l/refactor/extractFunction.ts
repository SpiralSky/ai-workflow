import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { CHANGE_RETURNS, DRY_RUN, refactorCall } from "./common.ts";

/** `extractFunction`: turn a line range into a new function and call it (rope). */
export function makeExtractFunction(sc?: Sidecar): ToolDef {
  return {
    name: "extractFunction",
    description: "Turn whole lines into a new function (a method when inside a method) and replace them with a call. Parameters and return values are inferred.",
    parameters: objectSchema({
      path: { type: "string", description: "Python file, relative to the workspace root." },
      range: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2, description: "[startLine, endLine], 1-based, inclusive." },
      name: { type: "string", description: "Name of the new function." },
      dryRun: DRY_RUN,
    }, ["path", "range", "name"]),
    returns: `{ ${CHANGE_RETURNS} }`,
    meta: {
      whenToUse: "Split a long function: pull a block of statements into a named function with inferred parameters.",
      whenNotToUse: "Not for a single expression (use extractVariable) or for code that must be moved to another file (use moveSymbol afterwards).",
      examples: ["extract lines 7-8 of pkg/calc.py into double_all"],
      category: "refactor",
      effect: "write",
      requires: [],
      cost: 2,
    },
    fn: (args: Record<string, unknown>, ctx) => refactorCall(sc, "extractFunction", args, ctx),
  };
}
