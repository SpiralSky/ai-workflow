import { readFile, writeFile } from "node:fs/promises";
import { mergeSummaries, summarizeChange } from "../../change.ts";
import { resolveInRoot } from "../../paths.ts";
import { objectSchema, type ToolDef } from "../../types.ts";

/**
 * `multiEdit`: several exact replacements across one or more files. Every edit is checked against
 * in-memory contents first (edits on one file apply in order, each seeing the previous result);
 * nothing is written unless all succeed.
 */
export const multiEdit: ToolDef = {
  name: "multiEdit",
  description: "Apply several exact string replacements across one or more files, all or nothing. Edits on the same file apply in order. Returns a change summary.",
  parameters: objectSchema(
    {
      edits: {
        type: "array",
        description: "Replacements to apply, in order.",
        items: objectSchema(
          {
            path: { type: "string", description: "File path, relative to the workspace root." },
            old: { type: "string", description: "Exact text to replace; must be unique unless all is true." },
            new: { type: "string", description: "Replacement text." },
            all: { type: "boolean", description: "Replace every match (default false)." },
          },
          ["path", "old", "new"],
        ),
      },
    },
    ["edits"],
  ),
  returns: "{ files: { path: string; added: number; removed: number }[]; diff?: string }",
  meta: {
    whenToUse: "Make a set of related exact edits at once, such as the same rename across several files or several fixes in one file.",
    whenNotToUse: "Not for a single replacement (use edit) or for symbol-aware renames (use a refactor tool).",
    examples: ["update an import and its call sites in three files", "apply several fixes to one module"],
    category: "fs",
    effect: "write",
    requires: ["readFile"],
    cost: 2,
  },
  async fn(args: { edits: { path: string; old: string; new: string; all?: boolean }[] }, ctx) {
    if (!Array.isArray(args.edits) || args.edits.length === 0) throw new Error("edits must not be empty");
    // abs path -> { original, current } contents
    const files = new Map<string, { before: string; after: string }>();
    for (const [i, e] of args.edits.entries()) {
      const tag = `edit ${i + 1} (${e.path})`;
      if (e.old === "") throw new Error(`${tag}: old must not be empty`);
      const abs = resolveInRoot(ctx.root, e.path);
      let f = files.get(abs);
      if (!f) {
        const text = await readFile(abs, "utf8").catch((err: NodeJS.ErrnoException) => {
          if (err.code === "ENOENT") throw new Error(`${tag}: no such file`);
          throw err;
        });
        f = { before: text, after: text };
        files.set(abs, f);
      }
      const count = f.after.split(e.old).length - 1;
      if (count === 0) throw new Error(`${tag}: not found`);
      if (count > 1 && !e.all) throw new Error(`${tag}: not unique (${count} matches); add context or pass all: true`);
      // split/join avoids `$` replacement patterns in e.new
      f.after = f.after.split(e.old).join(e.new);
    }
    for (const [abs, f] of files) await writeFile(abs, f.after);
    return mergeSummaries([...files].map(([abs, f]) => summarizeChange(ctx.root, abs, f.before, f.after)));
  },
};
