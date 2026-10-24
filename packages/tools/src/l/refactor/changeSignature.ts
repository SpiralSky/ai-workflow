import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { TARGET_PROPS } from "../nav/common.ts";
import { CHANGE_RETURNS, DRY_RUN, refactorCall } from "./common.ts";

/** `changeSignature`: add (with default), remove, rename or reorder parameters and update every call site (rope). */
export function makeChangeSignature(sc?: Sidecar): ToolDef {
  return {
    name: "changeSignature",
    description: "Change a function, method or constructor signature and update call sites. ops: {op:add,name,default,index?} {op:remove,name} {op:rename,name,to} {op:reorder,order:[names]}.",
    parameters: objectSchema({
      ...TARGET_PROPS,
      ops: {
        type: "array",
        description: "Edits applied in order; op is add, remove, rename or reorder.",
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["add", "remove", "rename", "reorder"] },
            name: { type: "string" },
            to: { type: "string" },
            default: { type: "string" },
            index: { type: "integer" },
            order: { type: "array", items: { type: "string" } },
          },
          required: ["op"],
        },
      },
      dryRun: DRY_RUN,
    }, ["ops"]),
    returns: `{ ${CHANGE_RETURNS} }`,
    meta: {
      whenToUse: "Add a parameter with a default, drop an unused one, rename or reorder parameters, keeping all callers correct.",
      whenNotToUse: "Not for changing only the body or return type (use edit), and not before checking callers' reach (use impact).",
      examples: ["add parameter limit=80 to pkg/util.py#slugify", "reorder parameters of Store.save to (key, value)"],
      category: "refactor",
      effect: "write",
      requires: [],
      cost: 3,
    },
    fn: (args: Record<string, unknown>, ctx) => refactorCall(sc, "changeSignature", args, ctx),
  };
}
