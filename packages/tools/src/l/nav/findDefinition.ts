import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { TARGET_PROPS, navCall } from "./common.ts";

/** `findDefinition`: where a name used at a position (or named in a file) is defined, resolved through imports. */
export function makeFindDefinition(sc?: Sidecar): ToolDef {
  return {
    name: "findDefinition",
    description: "Find where a name is defined, following imports. Point at it with symbol, or path plus name, or path plus line/col. Returns locations.",
    parameters: objectSchema(TARGET_PROPS, []),
    returns: "{ definitions: { name: string; kind: string; path?: string; line?: number; col?: number; symbol?: string; module?: string }[] }",
    meta: {
      whenToUse: "Jump from a use of a function, class or variable to the place that defines it.",
      whenNotToUse: "Not for finding all usages (use findReferences) or text search (use grep).",
      examples: ["where is `slugify` defined, used in app/views.py", "definition at app/views.py line 12 col 8"],
      category: "nav",
      effect: "read",
      requires: [],
      cost: 2,
    },
    fn: (args: Record<string, unknown>, ctx) => navCall(sc, "findDefinition", args, ctx),
  };
}
