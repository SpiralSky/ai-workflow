import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { CHANGE_RETURNS, DRY_RUN, refactorCall } from "./common.ts";

/**
 * `organizeImports`: rope's organizer (remove unused, drop duplicates, sort) plus hoisting of
 * function-local imports. A local import moves to the top only if it is a direct statement of the
 * function body, its module is stdlib or a workspace module that cannot import the file back, the
 * name does not clash, and the function keeps another statement; the rest are reported in `notHoisted`.
 * Unused imports are kept in `__init__.py` (re-exports). A file that is already tidy gives `files: []`.
 */
export function makeOrganizeImports(sc?: Sidecar): ToolDef {
  return {
    name: "organizeImports",
    description: "Remove unused imports, drop duplicates, sort, and move function-local imports to the top when safe (stdlib or cycle-free workspace modules). Keeps re-exports in __init__.py.",
    parameters: objectSchema({
      path: { type: "string", description: "Python file, relative to the workspace root." },
      dryRun: DRY_RUN,
    }, ["path"]),
    returns: `{ ${CHANGE_RETURNS}; hoisted?: { line: number; statement: string }[]; notHoisted?: { line: number; statement: string; reason: string }[] }`,
    meta: {
      whenToUse: "Tidy a file's imports after edits or refactors: unused ones removed, order fixed, safe local imports lifted.",
      whenNotToUse: "Not for formatting code (use format) or finding unused imports without changing them (use check).",
      examples: ["organize imports in pkg/views.py"],
      category: "refactor",
      effect: "write",
      requires: [],
      cost: 2,
    },
    fn: (args: Record<string, unknown>, ctx) => refactorCall(sc, "organizeImports", args, ctx),
  };
}
