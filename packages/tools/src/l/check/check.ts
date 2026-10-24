import { cutList } from "../../search.ts";
import { needSidecar, type Sidecar } from "../../sidecar.ts";
import { relPath, resolveInRoot } from "../../paths.ts";
import { objectSchema, type ToolDef } from "../../types.ts";

/** `check`: pyright type check and ruff lint as structured diagnostics. */
export function makeCheck(sc?: Sidecar): ToolDef {
  return {
    name: "check",
    description: "Type check (pyright) and lint (ruff) a Python file or the whole workspace. Returns diagnostics with path, line, col, severity, code, message, source.",
    parameters: objectSchema(
      {
        path: { type: "string", description: "File or directory (default: whole workspace)." },
        kinds: { type: "array", items: { type: "string", enum: ["types", "lint"] }, description: "Checks to run (default both)." },
      },
      [],
    ),
    returns: "{ diagnostics: { path: string; line: number; col: number; severity: string; code: string | null; message: string; source: string }[]; counts: Record<string, number>; truncated?: string }",
    meta: {
      whenToUse: "Find type errors and lint problems after editing, or to see what is wrong in a file.",
      whenNotToUse: "Not for behaviour: it does not run code (use runTests).",
      examples: ["check src/app/models.py", "lint only the whole project"],
      category: "check",
      effect: "read",
      requires: [],
      cost: 3,
    },
    async fn(args: { path?: string; kinds?: string[] }, ctx) {
      const sidecar = needSidecar(sc);
      const params: Record<string, unknown> = { kinds: args.kinds };
      if (args.path) params.path = relPath(ctx.root, resolveInRoot(ctx.root, args.path));
      const res = (await sidecar.call("check", params, ctx.signal)) as { diagnostics: unknown[]; counts: Record<string, number>; truncated?: string };
      const { kept, truncated } = cutList(res.diagnostics, 40, "pass path or kinds to narrow");
      const hint = truncated ?? res.truncated;
      return hint ? { ...res, diagnostics: kept, truncated: hint } : { ...res, diagnostics: kept };
    },
  };
}
