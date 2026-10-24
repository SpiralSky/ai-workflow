import type { Sidecar } from "../../sidecar.ts";
import type { ToolDef } from "../../types.ts";
import { makeFindDefinition } from "./findDefinition.ts";
import { makeFindReferences } from "./findReferences.ts";
import { makeOutline } from "./outline.ts";
import { makeReadSymbol } from "./readSymbol.ts";
import { makeSignature } from "./signature.ts";

/** The `nav` group in tools.md §6.2 order, bound to a sidecar (tools throw `no sidecar` without one). */
export function navTools(sc?: Sidecar): ToolDef[] {
  return [makeOutline(sc), makeReadSymbol(sc), makeFindDefinition(sc), makeFindReferences(sc), makeSignature(sc)];
}
