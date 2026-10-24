import { needSidecar, type Sidecar } from "../../sidecar.ts";
import { relPath, resolveInRoot } from "../../paths.ts";
import { objectSchema, type ToolDef } from "../../types.ts";

/** `format`: runs the workspace's configured formatter and reports which files changed. */
export function makeFormat(sc?: Sidecar): ToolDef {
  return {
    name: "format",
    description: "Format Python files with the workspace's configured formatter (ruff format / black settings in pyproject.toml). Throws if none is configured. Returns changed files.",
    parameters: objectSchema({ path: { type: "string", description: "File or directory (default: whole workspace)." } }, []),
    returns: "{ files: { path: string; added: number; removed: number }[] }",
    meta: {
      whenToUse: "Apply the project's code style to a file or tree after editing.",
      whenNotToUse: "Not for fixing lint or type errors (use check and edit).",
      examples: ["format src/app/models.py", "format the whole project"],
      category: "check",
      effect: "write",
      requires: [],
      cost: 2,
    },
    async fn(args: { path?: string }, ctx) {
      const sidecar = needSidecar(sc);
      const params: Record<string, unknown> = {};
      if (args.path) params.path = relPath(ctx.root, resolveInRoot(ctx.root, args.path));
      return sidecar.call("format", params, ctx.signal);
    },
  };
}
