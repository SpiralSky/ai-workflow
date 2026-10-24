import { readFile as fsRead } from "node:fs/promises";
import { resolveInRoot } from "../paths.ts";
import { objectSchema, type ToolDef } from "../types.ts";

/** Max bytes of numbered text returned before truncating at a line boundary. */
export const READ_CAP_BYTES = 8000;

/** `readFile`: line-numbered text (`cat -n` style), 1-based inclusive `range`, truncated at a line boundary over ~8 KB. */
export const readFile: ToolDef = {
  name: "readFile",
  description: "Read a text file with line numbers. Optional 1-based inclusive line range; long output stops at a line boundary with a note.",
  parameters: objectSchema(
    {
      path: { type: "string", description: "File path, relative to the workspace root." },
      range: {
        type: "array",
        items: { type: "integer" },
        minItems: 2,
        maxItems: 2,
        description: "[start, end] line numbers, 1-based, inclusive.",
      },
    },
    ["path"],
  ),
  returns: "string",
  meta: {
    whenToUse: "Look at the contents of a known file, or a line range of it, before editing or to understand code.",
    whenNotToUse: "Not for finding which file contains something (use grep) or listing files (use findFiles).",
    examples: ["show lines 40-80 of src/app.py", "read the config file"],
    category: "fs",
    effect: "read",
    requires: [],
    cost: 1,
  },
  async fn(args: { path: string; range?: [number, number] }, ctx) {
    const abs = resolveInRoot(ctx.root, args.path);
    const all = (await fsRead(abs, "utf8")).split("\n");
    if (all[all.length - 1] === "") all.pop();
    const total = all.length;
    let start = 1, end = total;
    if (args.range) {
      [start, end] = args.range;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) throw new Error(`invalid range: [${args.range}]`);
      end = Math.min(end, total);
      if (start > total) throw new Error(`range starts past end of file (${total} lines)`);
    }
    const out: string[] = [];
    let bytes = 0;
    let stoppedAt = 0;
    for (let n = start; n <= end; n++) {
      const row = `${String(n).padStart(6)}\t${all[n - 1]}`;
      bytes += Buffer.byteLength(row) + 1;
      if (bytes > READ_CAP_BYTES && out.length > 0) { stoppedAt = n - 1; break; }
      out.push(row);
    }
    if (stoppedAt) out.push(`[truncated at line ${stoppedAt} of ${total}; pass range to read more]`);
    return out.join("\n");
  },
};
