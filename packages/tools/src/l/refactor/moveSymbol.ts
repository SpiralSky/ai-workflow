import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { TARGET_PROPS } from "../nav/common.ts";
import { CHANGE_RETURNS, DRY_RUN, refactorCall } from "./common.ts";

/** `moveSymbol`: move a module-level function, class or constant to another module and rewrite its users' imports (rope). */
export function makeMoveSymbol(sc?: Sidecar): ToolDef {
  return {
    name: "moveSymbol",
    description: "Move a module-level function, class or constant to another module (created if missing) and rewrite imports in every user. Fails if it would create an import cycle.",
    parameters: objectSchema({
      ...TARGET_PROPS,
      to: { type: "string", description: "Destination module file, e.g. pkg/text.py." },
      keepReexport: { type: "boolean", description: "Leave `from <dest> import <name>` in the source module (default false)." },
      dryRun: DRY_RUN,
    }, ["to"]),
    returns: `{ ${CHANGE_RETURNS} }`,
    meta: {
      whenToUse: "Relocate a function, class or constant to a better module without breaking its users.",
      whenNotToUse: "Not for methods or whole modules (use moveModule), and not for copying code (use readSymbol and edit).",
      examples: ["move pkg/util.py#shout to pkg/text.py", "move CONFIG from app/core.py to app/settings.py keeping a re-export"],
      category: "refactor",
      effect: "write",
      requires: [],
      cost: 3,
    },
    fn: (args: Record<string, unknown>, ctx) => refactorCall(sc, "moveSymbol", args, ctx),
  };
}
