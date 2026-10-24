import ts from "typescript-api";
import type { CompiledBranch, CompileError } from "./types.ts";
import { findForbidden, findRoot, instrument } from "./instrument.ts";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const NOT_ARROW = "branch program must be an async arrow function: async (tools, state) => { ... }";

/**
 * Decodes a source map `mappings` string into the first source line (0-based) per generated line.
 * Lines without a mapping are `undefined`.
 */
function firstSourceLines(mappings: string): (number | undefined)[] {
  const lines: (number | undefined)[] = [];
  let srcLine = 0;
  for (const group of mappings.split(";")) {
    let first: number | undefined;
    for (const seg of group.split(",")) {
      if (!seg) continue;
      const fields: number[] = [];
      let value = 0;
      let shift = 0;
      for (const ch of seg) {
        const digit = B64.indexOf(ch);
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          fields.push(value & 1 ? -(value >> 1) : value >> 1);
          value = shift = 0;
        }
      }
      // fields: [genCol, srcIndex, srcLine, srcCol, name?]; srcLine is cumulative across lines.
      if (fields.length >= 4) {
        srcLine += fields[2];
        first ??= srcLine;
      }
    }
    lines.push(first);
  }
  return lines;
}

/**
 * Compiles a branch program: parses, validates, instruments (line-preserving) and strips types.
 * @param source - the model's program text, an async arrow function
 * @returns a single JS expression plus a line map, or a `CompileError` with a 1-based line
 */
export function compileBranch(source: string): CompiledBranch | CompileError {
  // A trailing `;` after the arrow would be a syntax error inside the wrapper; blank it out.
  const body = source.replace(/;(\s*)$/, " $1");
  const wrapped = "(" + body + "\n)";
  const sf = ts.createSourceFile("branch.ts", wrapped, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;

  const forbidden = findForbidden(sf);
  if (forbidden) return { error: "compile", ...forbidden };

  const syntax = ts.transpileModule(wrapped, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  const d = syntax.diagnostics?.find((x) => x.category === ts.DiagnosticCategory.Error);
  if (d) {
    return {
      error: "compile",
      message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      ...(d.start !== undefined ? { line: lineOf(d.start) } : {}),
    };
  }

  const root = findRoot(sf);
  if (!root) return { error: "compile", message: NOT_ARROW, line: 1 };

  const instrumented = instrument(sf, body, root);
  const out = ts.transpileModule("(" + instrumented + "\n)", {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      sourceMap: true,
      removeComments: false,
    },
    reportDiagnostics: true,
  });
  const err = out.diagnostics?.find((x) => x.category === ts.DiagnosticCategory.Error);
  if (err) return { error: "compile", message: ts.flattenDiagnosticMessageText(err.messageText, "\n") };

  let js = out.outputText.replace(/\n?\/\/# sourceMappingURL=.*\s*$/, "");
  // Drop anything before the expression (e.g. "use strict"), keeping the line map in step.
  const cut = js.search(/\(\s*async\b/);
  const dropped = cut > 0 ? js.slice(0, cut).split("\n").length - 1 : 0;
  js = js.slice(Math.max(cut, 0)).replace(/[;\s]+$/, "");

  const mappings = JSON.parse(out.sourceMapText ?? "{}").mappings ?? "";
  const lineMap: number[] = [];
  let prev = 1;
  firstSourceLines(mappings).slice(dropped).forEach((l) => lineMap.push((prev = l === undefined ? prev : l + 1)));
  const jsLines = js.split("\n").length;
  while (lineMap.length < jsLines) lineMap.push(prev);
  lineMap.length = jsLines;
  return { js, lineMap };
}
