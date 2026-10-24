import { cutList, filesJS, filesRg, hasRg } from "../search.ts";
import { relPath, resolveInRoot } from "../paths.ts";
import { objectSchema, type ToolDef } from "../types.ts";

/** Max files returned. */
const MAX_FILES = 200;

/** `findFiles`: glob over file paths; sorted root-relative results. */
export const findFiles: ToolDef = {
  name: "findFiles",
  description: "List files whose path matches a glob, sorted. A glob without / matches the file name at any depth. Skips .git, node_modules, hidden and gitignored files.",
  parameters: objectSchema(
    {
      pattern: { type: "string", description: "Glob, e.g. *.py or tests/**/test_*.py." },
      path: { type: "string", description: "Directory to search (default: whole workspace)." },
    },
    ["pattern"],
  ),
  returns: "{ files: string[]; truncated?: string }",
  meta: {
    whenToUse: "Find files by name or extension, or list what exists in a directory tree.",
    whenNotToUse: "Not for searching inside file contents (use grep).",
    examples: ["find all test files", "list python files under src"],
    category: "search",
    effect: "read",
    requires: [],
    cost: 1,
  },
  async fn(args: { pattern: string; path?: string }, ctx) {
    const abs = resolveInRoot(ctx.root, args.path ?? ".");
    const all = hasRg() ? await filesRg(ctx.root, args.pattern, relPath(ctx.root, abs)) : filesJS(ctx.root, abs, args.pattern);
    const { kept, truncated } = cutList(all, MAX_FILES, "narrow with path or a more specific pattern");
    return truncated ? { files: kept, truncated } : { files: kept };
  },
};
