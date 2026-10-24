import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { CHANGE_RETURNS, DRY_RUN, refactorCall } from "./common.ts";

/** `extractVariable`: pull an expression into a named local variable or module constant (rope). */
export function makeExtractVariable(sc?: Sidecar): ToolDef {
  return {
    name: "extractVariable",
    description: "Pull a single-line expression into a named variable (local, or a module-level constant) and use the name in its place.",
    parameters: objectSchema({
      path: { type: "string", description: "Python file, relative to the workspace root." },
      line: { type: "integer", description: "1-based line holding the expression." },
      expression: { type: "string", description: "Exact source text of the expression on that line." },
      col: { type: "integer", description: "1-based column of the expression if the line repeats it." },
      name: { type: "string", description: "Name of the new variable." },
      scope: { type: "string", enum: ["local", "module"], description: "local (default) or module-level constant." },
      dryRun: DRY_RUN,
    }, ["path", "line", "expression", "name"]),
    returns: `{ ${CHANGE_RETURNS} }`,
    meta: {
      whenToUse: "Name a magic number or a repeated sub-expression, or lift a constant to module level.",
      whenNotToUse: "Not for statements or multi-line blocks (use extractFunction).",
      examples: ["extract `3600 * 24` on line 18 of pkg/calc.py as DAY at module scope"],
      category: "refactor",
      effect: "write",
      requires: [],
      cost: 2,
    },
    fn: (args: Record<string, unknown>, ctx) => refactorCall(sc, "extractVariable", args, ctx),
  };
}
