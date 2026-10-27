import type { Sidecar } from "../../sidecar.ts";
import type { ToolDef } from "../../types.ts";
import { makeChangeSignature } from "./changeSignature.ts";
import { makeExtractFunction } from "./extractFunction.ts";
import { makeExtractVariable } from "./extractVariable.ts";
import { makeInlineSymbol } from "./inlineSymbol.ts";
import { makeMoveModule } from "./moveModule.ts";
import { makeMoveSymbol } from "./moveSymbol.ts";
import { makeOrganizeImports } from "./organizeImports.ts";
import { makeRenameSymbol } from "./renameSymbol.ts";
import { makeReplaceSymbol } from "./replaceSymbol.ts";

/** The `refactor` group in tools.md §6.4 order, bound to a sidecar (tools throw `no sidecar` without one). */
export function refactorTools(sc?: Sidecar): ToolDef[] {
  return [
    makeRenameSymbol(sc), makeMoveSymbol(sc), makeMoveModule(sc), makeExtractFunction(sc),
    makeInlineSymbol(sc), makeChangeSignature(sc), makeExtractVariable(sc), makeOrganizeImports(sc),
    makeReplaceSymbol(sc),
  ];
}
