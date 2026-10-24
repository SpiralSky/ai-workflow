import { cutList, grepJS, grepRg, hasRg } from "../search.ts";
import { relPath, resolveInRoot } from "../paths.ts";
import { objectSchema, type ToolDef } from "../types.ts";

/** Default and maximum `maxResults`. */
const DEFAULT_MAX = 100;
const HARD_MAX = 500;

/** `grep`: regex search over file contents (ripgrep when available, else a JS walk); results sorted by path and line. */
export const grep: ToolDef = {
  name: "grep",
  description: "Regex search over file contents. Returns matching lines as { path, line, text }. Skips .git, node_modules, hidden and gitignored files, and binary files.",
  parameters: objectSchema(
    {
      pattern: { type: "string", description: "Regular expression to search for." },
      path: { type: "string", description: "File or directory to search (default: whole workspace)." },
      glob: { type: "string", description: "Only files matching this glob, e.g. *.py." },
      ignoreCase: { type: "boolean", description: "Case-insensitive match (default false)." },
      maxResults: { type: "integer", description: "Max matches returned (default 100, max 500)." },
    },
    ["pattern"],
  ),
  returns: "{ matches: { path: string; line: number; text: string }[]; truncated?: string }",
  meta: {
    whenToUse: "Find where a symbol, string or pattern appears in file contents, or which files mention something.",
    whenNotToUse: "Not for finding files by name (use findFiles) or reading a known file (use readFile).",
    examples: ["find where parseConfig is defined", "search for TODO comments in src"],
    category: "search",
    effect: "read",
    requires: [],
    cost: 2,
  },
  async fn(args: { pattern: string; path?: string; glob?: string; ignoreCase?: boolean; maxResults?: number }, ctx) {
    const abs = resolveInRoot(ctx.root, args.path ?? ".");
    const max = Math.min(Math.max(args.maxResults ?? DEFAULT_MAX, 1), HARD_MAX);
    const all = hasRg()
      ? await grepRg(ctx.root, args.pattern, relPath(ctx.root, abs), args.glob, !!args.ignoreCase)
      : grepJS(ctx.root, abs, args.pattern, args.glob, !!args.ignoreCase);
    const { kept, truncated } = cutList(all, max, "narrow with path or glob, or a more specific pattern");
    return truncated ? { matches: kept, truncated } : { matches: kept };
  },
};
