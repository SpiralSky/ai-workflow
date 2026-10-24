import { mkdir, readFile, writeFile as fsWrite } from "node:fs/promises";
import { dirname } from "node:path";
import { summarizeChange } from "../change.ts";
import { resolveInRoot } from "../paths.ts";
import { objectSchema, type ToolDef } from "../types.ts";

/** `writeFile`: creates or overwrites a file (making parent directories); returns a change summary. */
export const writeFile: ToolDef = {
  name: "writeFile",
  description: "Create a file or overwrite it with the given content, creating parent directories. Returns a change summary, not the file.",
  parameters: objectSchema(
    {
      path: { type: "string", description: "File path, relative to the workspace root." },
      content: { type: "string", description: "Full new file content." },
    },
    ["path", "content"],
  ),
  returns: "{ files: { path: string; added: number; removed: number }[]; diff?: string }",
  meta: {
    whenToUse: "Create a new file, or replace a whole file's content.",
    whenNotToUse: "Not for small changes to an existing file; use edit.",
    examples: ["create tests/test_foo.py", "overwrite the README"],
    category: "fs",
    effect: "write",
    requires: [],
    cost: 1,
  },
  async fn(args: { path: string; content: string }, ctx) {
    const abs = resolveInRoot(ctx.root, args.path);
    const before = await readFile(abs, "utf8").catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    await mkdir(dirname(abs), { recursive: true });
    await fsWrite(abs, args.content);
    return summarizeChange(ctx.root, abs, before, args.content);
  },
};
