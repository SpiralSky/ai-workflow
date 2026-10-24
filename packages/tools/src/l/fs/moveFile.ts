import { mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { summarizeChange, type ChangeSummary } from "../../change.ts";
import { relPath, resolveInRoot } from "../../paths.ts";
import { objectSchema, type ToolDef } from "../../types.ts";

/** Number of lines in a text. */
function lineCount(text: string): number {
  if (text === "") return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

/**
 * `moveFile`: moves or renames one file, creating parent directories. Refuses to replace an existing
 * target unless `overwrite` is true. Change summary: the source path counts as all lines removed, the
 * target as all lines added (a replaced target is diffed against its old content); no diff is included.
 */
export const moveFile: ToolDef = {
  name: "moveFile",
  description: "Move or rename a file, creating parent directories. Fails if the target exists unless overwrite is true. Does not update imports. Returns a change summary.",
  parameters: objectSchema(
    {
      from: { type: "string", description: "Existing file path, relative to the workspace root." },
      to: { type: "string", description: "New file path, relative to the workspace root." },
      overwrite: { type: "boolean", description: "Replace the target if it exists (default false)." },
    },
    ["from", "to"],
  ),
  returns: "{ files: { path: string; added: number; removed: number }[]; diff?: string }",
  meta: {
    whenToUse: "Rename a file or move it to another directory, such as a non-source file or a file whose imports do not matter.",
    whenNotToUse: "Not for source files that others import; use moveModule, which fixes imports.",
    examples: ["rename notes.txt to docs/notes.txt", "move a fixture into the tests directory"],
    category: "fs",
    effect: "write",
    requires: [],
    cost: 1,
  },
  async fn(args: { from: string; to: string; overwrite?: boolean }, ctx) {
    const src = resolveInRoot(ctx.root, args.from);
    const dst = resolveInRoot(ctx.root, args.to);
    const st = await stat(src).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") throw new Error(`no such file: ${args.from}`);
      throw e;
    });
    if (!st.isFile()) throw new Error(`not a file: ${args.from}`);
    if (src === dst) throw new Error("from and to are the same path");
    const dstStat = await stat(dst).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (dstStat && !args.overwrite) throw new Error(`target exists: ${args.to}; pass overwrite: true to replace it`);
    if (dstStat && !dstStat.isFile()) throw new Error(`target is not a file: ${args.to}`);
    const content = await readFile(src, "utf8");
    const old = dstStat ? await readFile(dst, "utf8") : null;
    await mkdir(dirname(dst), { recursive: true });
    await rename(src, dst);
    const target = summarizeChange(ctx.root, dst, old, content).files[0]!;
    const out: ChangeSummary = {
      files: [{ path: relPath(ctx.root, src), added: 0, removed: lineCount(content) }, target],
    };
    return out;
  },
};
