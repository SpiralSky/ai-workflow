import { relPath, resolveInRoot } from "../../paths.ts";
import { cutList } from "../../search.ts";
import { objectSchema, type ToolCtx, type ToolDef } from "../../types.ts";
import { runGit } from "./common.ts";

const MAX_COMMITS = 20;
const MAX_BLAME = 200;
const LOG_FORMAT = "--format=%h%x09%an%x09%aI%x09%s";

interface Commit { hash: string; author: string; date: string; subject: string }
interface BlameLine { line: number; hash: string; author: string; date: string; text: string }

/** Parses `LOG_FORMAT` output lines. */
function parseLog(out: string): Commit[] {
  return out.split("\n").filter((l) => l.includes("\t")).map((l) => {
    const [hash, author, date, ...rest] = l.split("\t");
    return { hash: hash!, author: author!, date: date!, subject: rest.join("\t") };
  });
}

/** Parses `git blame --porcelain` output. */
function parseBlame(out: string): BlameLine[] {
  const meta = new Map<string, { author: string; date: string }>();
  const res: BlameLine[] = [];
  let cur: { hash: string; line: number } | undefined;
  for (const l of out.split("\n")) {
    if (l.startsWith("\t")) {
      const m = meta.get(cur!.hash)!;
      res.push({ line: cur!.line, hash: cur!.hash.slice(0, 7), author: m.author, date: m.date, text: l.slice(1) });
    } else if (/^[0-9a-f]{40} \d+ \d+/.test(l)) {
      const [hash, , final] = l.split(" ");
      cur = { hash: hash!, line: Number(final) };
      if (!meta.has(hash!)) meta.set(hash!, { author: "", date: "" });
    } else if (cur && l.startsWith("author ")) meta.get(cur.hash)!.author = l.slice(7);
    else if (cur && l.startsWith("author-time ")) meta.get(cur.hash)!.date = new Date(Number(l.slice(12)) * 1000).toISOString();
  }
  return res;
}

/** Ensures the workspace is inside a git repository that has at least one commit. @throws `no history` */
async function requireRepo(ctx: ToolCtx): Promise<void> {
  const r = await runGit(ctx, ["rev-parse", "--is-inside-work-tree"]);
  if (r.code !== 0 || r.out.trim() !== "true") throw new Error("no history");
  if ((await runGit(ctx, ["rev-parse", "--verify", "HEAD"])).code !== 0) throw new Error("no history");
}

/**
 * `history`: commit log of a file, of a line range (log plus blame) or of a symbol, via `git log`
 * and `git blame`. Throws `no history` when the workspace is not in a git repository.
 */
export const history: ToolDef = {
  name: "history",
  description: "Git history of a file, a line range (log plus blame) or a symbol: commits with author, date and subject. Fails with no history outside a git repository.",
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
      symbol: { type: "string", description: "Function or class name in the file, or path#Name." },
    },
    ["path"],
  ),
  returns: "{ commits: { hash: string; author: string; date: string; subject: string }[]; blame?: { line: number; hash: string; author: string; date: string; text: string }[]; truncated?: string }",
  meta: {
    whenToUse: "Find out when and why a file, a block of lines or a function changed, or who last touched a line.",
    whenNotToUse: "Not for the changes made in this job (use diff).",
    examples: ["show recent commits touching src/app.py", "blame lines 40-60 of utils.py"],
    category: "vcs",
    effect: "read",
    requires: [],
    cost: 2,
  },
  async fn(args: { path: string; range?: [number, number]; symbol?: string }, ctx) {
    await requireRepo(ctx);
    const rel = relPath(ctx.root, resolveInRoot(ctx.root, args.path));
    if (args.range && args.symbol) throw new Error("pass range or symbol, not both");
    const run = async (a: string[]) => {
      const r = await runGit(ctx, a);
      if (r.code !== 0) throw new Error(`git failed: ${r.err.trim() || `exit ${r.code}`}`);
      return r.out;
    };
    let blame: BlameLine[] | undefined;
    let commits: Commit[];
    if (args.range) {
      const [s, e] = args.range;
      if (!Number.isInteger(s) || !Number.isInteger(e) || s < 1 || e < s) throw new Error(`invalid range: [${args.range}]`);
      commits = parseLog(await run(["log", `-n${MAX_COMMITS}`, "-s", LOG_FORMAT, `-L${s},${e}:${rel}`]));
      blame = parseBlame(await run(["blame", "--porcelain", `-L${s},${e}`, "--", rel]));
    } else if (args.symbol) {
      const name = args.symbol.includes("#") ? args.symbol.slice(args.symbol.indexOf("#") + 1) : args.symbol;
      if (!/^[\w.$]+$/.test(name)) throw new Error(`invalid symbol: ${args.symbol}`);
      commits = parseLog(await run(["log", `-n${MAX_COMMITS}`, "-s", LOG_FORMAT, `-L:${name.split(".").pop()}:${rel}`]));
    } else {
      commits = parseLog(await run(["log", `-n${MAX_COMMITS}`, "--follow", LOG_FORMAT, "--", rel]));
    }
    if (commits.length === 0) throw new Error(`no commits touch ${rel}`);
    const cutB = blame ? cutList(blame, MAX_BLAME, "narrow range") : undefined;
    const cutC = cutList(commits, MAX_COMMITS, "narrow with range or symbol");
    const more = commits.length >= MAX_COMMITS ? `showing the latest ${MAX_COMMITS} commits; narrow with range or symbol` : undefined;
    const truncated = [cutC.truncated ?? more, cutB?.truncated].filter(Boolean).join("; ");
    const out: Record<string, unknown> = { commits: cutC.kept };
    if (cutB) out.blame = cutB.kept;
    if (truncated) out.truncated = truncated;
    return out;
  },
};
