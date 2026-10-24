import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cutList } from "../../search.ts";
import { relPath, resolveInRoot } from "../../paths.ts";
import { objectSchema, type ToolDef } from "../../types.ts";

/** Entries returned at most. */
const MAX_ENTRIES = 200;
const SKIP = new Set([".git", "node_modules"]);

interface Entry { path: string; type: "file" | "dir"; size: number }

/** Lists `dir` pre-order (names in code-unit order) to `depth` levels; returns the total byte size under `dir`. */
function walkDir(root: string, dir: string, level: number, depth: number, out: Entry[]): number {
  let total = 0;
  const kids = readdirSync(dir, { withFileTypes: true }).filter((e) => !SKIP.has(e.name) && (e.isDirectory() || e.isFile()));
  kids.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const k of kids) {
    const abs = join(dir, k.name);
    if (k.isDirectory()) {
      const slot = level < depth ? out.push({ path: relPath(root, abs), type: "dir", size: 0 }) - 1 : -1;
      const size = walkDir(root, abs, level + 1, depth, out);
      if (slot >= 0) out[slot]!.size = size;
      total += size;
    } else {
      const size = statSync(abs).size;
      if (level < depth) out.push({ path: relPath(root, abs), type: "file", size });
      total += size;
    }
  }
  return total;
}

/** `listDir`: pre-order tree of a directory to `depth` levels with byte sizes (directories show their total content size). */
export const listDir: ToolDef = {
  name: "listDir",
  description: "List a directory as a tree to a given depth, with sizes in bytes (directories show total content size). Skips .git and node_modules.",
  parameters: objectSchema(
    {
      path: { type: "string", description: "Directory to list (default: workspace root)." },
      depth: { type: "integer", description: "Levels to show (default 2)." },
    },
    [],
  ),
  returns: "{ entries: { path: string; type: 'file' | 'dir'; size: number }[]; truncated?: string }",
  meta: {
    whenToUse: "Get a feel for the project layout or see what a directory contains and how big things are.",
    whenNotToUse: "Not for matching files by pattern or name (use findFiles).",
    examples: ["show the top two levels of the project", "list src with sizes"],
    category: "fs",
    effect: "read",
    requires: [],
    cost: 1,
  },
  async fn(args: { path?: string; depth?: number }, ctx) {
    const abs = resolveInRoot(ctx.root, args.path ?? ".");
    const depth = args.depth ?? 2;
    if (!Number.isInteger(depth) || depth < 1) throw new Error(`invalid depth: ${args.depth}`);
    let st;
    try { st = statSync(abs); } catch { throw new Error(`no such directory: ${args.path}`); }
    if (!st.isDirectory()) throw new Error(`not a directory: ${args.path}`);
    const all: Entry[] = [];
    walkDir(ctx.root, abs, 0, depth, all);
    const { kept, truncated } = cutList(all, MAX_ENTRIES, "pass a subdirectory path or a smaller depth");
    return truncated ? { entries: kept, truncated } : { entries: kept };
  },
};
