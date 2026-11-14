import type { Procedure, ProcedureTool, ToolResult } from "@aiw/core/procedural";
import { makeCheck } from "./l/check/check.ts";
import { makeFindReferences } from "./l/nav/findReferences.ts";
import { makeRenameSymbol } from "./l/refactor/renameSymbol.ts";
import type { Sidecar } from "./sidecar.ts";
import type { ToolDef } from "./types.ts";

/**
 * Adapts a tier-L tool to a procedure tool: the tool runs against the procedure's workspace and
 * its return value becomes the `ToolResult`.
 * @param tool - the tier-L tool to call
 * @param interpret - maps the tool's return value to the result fields (`ok`, `reason`, `noFit`)
 * @param noFitError - thrown error messages matching this mean a precondition was unmet
 */
function wrap(tool: ToolDef, interpret: (value: any) => Partial<ToolResult>, noFitError?: RegExp): ProcedureTool {
  return async (workspace, args) => {
    try {
      const value = await tool.fn(args, { root: workspace, signal: new AbortController().signal });
      return { ok: true, ...(value as object), ...interpret(value) };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // An unmet precondition is reported before anything was written.
      if (noFitError?.test(reason)) return { ok: false, noFit: true, reason };
      return { ok: false, reason };
    }
  };
}

/**
 * Procedure tools backed by the tier-L tools `findReferences`, `renameSymbol` and `check`.
 * @param sidecar - Python sidecar started for the workspace the procedure will run in
 * @returns tool map for `executeProcedure`
 */
export function tierLProcedureTools(sidecar: Sidecar): Record<string, ProcedureTool> {
  return {
    findReferences: wrap(
      makeFindReferences(sidecar),
      (v) => (v.references.length ? {} : { ok: false, noFit: true, reason: "no references found" }),
      /symbol not found|no such file/,
    ),
    renameSymbol: wrap(makeRenameSymbol(sidecar), () => ({})),
    check: wrap(makeCheck(sidecar), (v) => {
      const errors = v.counts?.error ?? 0;
      return errors ? { ok: false, reason: `${errors} type or lint errors` } : {};
    }),
  };
}

/** Renames a Python symbol with the tier-L tools: find references, rename (rope), then type check and lint. */
export const renameKnownSymbolTierL: Procedure = {
  version: 1,
  id: "rename-known-symbol-tierL",
  category: "transform",
  description: "Renames one Python class or function across the workspace with the tier-L refactoring tools, and applies when the symbol is known as path#Name and is referenced somewhere.",
  inputs: { symbol: "string", newName: "identifier", checkPath: "string" },
  steps: [
    { id: "findReferences", tool: "findReferences", dependsOn: [], args: { symbol: { input: "symbol" } } },
    { id: "renameSymbol", tool: "renameSymbol", dependsOn: ["findReferences"], args: { symbol: { input: "symbol" }, newName: { input: "newName" } } },
    { id: "check", tool: "check", dependsOn: ["renameSymbol"], args: { path: { input: "checkPath" } } },
  ],
};
