import { readFile, writeFile } from "node:fs/promises";
import { summarizeChange } from "../change.ts";
import { resolveInRoot } from "../paths.ts";
import { objectSchema, type ToolDef } from "../types.ts";

/** `edit`: exact string replace in one file; fails when `old` is absent, or not unique without `all`. */
export const edit: ToolDef = {
  name: "edit",
  description: "Replace an exact string in a file. Fails if the string is missing, or matches more than once unless all is true. Returns a change summary.",
  parameters: objectSchema(
    {
      path: { type: "string", description: "File path, relative to the workspace root." },
      old: { type: "string", description: "Exact text to replace; include context to be unique." },
      new: { type: "string", description: "Replacement text." },
      all: { type: "boolean", description: "Replace every match (default false)." },
    },
    ["path", "old", "new"],
  ),
  returns: "{ files: { path: string; added: number; removed: number }[]; diff?: string }",
  meta: {
    whenToUse: "Change part of an existing file: fix a line, rename something, replace a block.",
    whenNotToUse: "Not for creating files or rewriting one entirely; use writeFile.",
    examples: ["rename a variable in one file", "fix an off-by-one in a function"],
    category: "fs",
    effect: "write",
    requires: ["readFile"],
    cost: 1,
  },
  async fn(args: { path: string; old: string; new: string; all?: boolean }, ctx) {
    if (args.old === "") throw new Error("old must not be empty");
    const abs = resolveInRoot(ctx.root, args.path);
    const before = await readFile(abs, "utf8");
    const count = before.split(args.old).length - 1;
    if (count === 0) throw new Error("not found");
    if (count > 1 && !args.all) throw new Error(`not unique (${count} matches); add context or pass all: true`);
    // split/join avoids `$` replacement patterns in args.new
    const after = before.split(args.old).join(args.new);
    await writeFile(abs, after);
    return summarizeChange(ctx.root, abs, before, after);
  },
};
