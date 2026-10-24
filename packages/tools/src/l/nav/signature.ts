import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { TARGET_PROPS, navCall } from "./common.ts";

/** `signature`: signature, docstring and inferred types of a symbol. */
export function makeSignature(sc?: Sidecar): ToolDef {
  return {
    name: "signature",
    description: "Get a symbol's signature with type annotations, docstring and inferred types. Point at it like findDefinition.",
    parameters: objectSchema(TARGET_PROPS, []),
    returns: "{ name: string; kind: string; signature: string; docstring: string | null; types: string[]; path?: string; line?: number; symbol?: string; module?: string }",
    meta: {
      whenToUse: "Check how to call a function or what a class takes before using or changing it.",
      whenNotToUse: "Not for the body (use readSymbol) or for the callers (use findReferences).",
      examples: ["signature of core/util.py#slugify", "signature of `open` at app/io.py line 4"],
      category: "nav",
      effect: "read",
      requires: [],
      cost: 1,
    },
    fn: (args: Record<string, unknown>, ctx) => navCall(sc, "signature", args, ctx),
  };
}
