import type { HotPathSnippet } from "./types.ts";

/** Input: state.path (relative changed source file); validates returned diagnostic location before reading it. */
export const snippet: HotPathSnippet = {
  id: "check-errors-read",
  description: "Check a changed file for type and lint errors; inspect a bounded line window around the first error instead of dumping every diagnostic.",
  tools: ["check", "readFile"],
  outcome: "check-errors",
  code: String.raw`async (tools, state) => {
  const safePath = (p) => typeof p === "string" && p.length > 0 && p.length <= 512 && !/^[\\/]|^[A-Za-z]:|[\x00-\x1f\x7f\\]/.test(p) && !p.split("/").includes("..");
  const { path } = state;
  if (!safePath(path) || /(?:^|\/)\.?$/.test(path)) throw new Error("invalid check path");
  const result = await tools.check({ path });
  const first = result.diagnostics.find((d) => d.severity === "error");
  if (!first) return { counts: result.counts, status: (result.counts.error ?? 0) === 0 && !result.truncated ? "clean" : "no-visible-error", error: null, truncated: result.truncated };
  if (!safePath(first.path) || /(?:^|\/)\.?$/.test(first.path) || !Number.isSafeInteger(first.line) || first.line < 1 || first.line > Number.MAX_SAFE_INTEGER - 3) throw new Error("invalid diagnostic location");
  const text = await tools.readFile({ path: first.path, range: [Math.max(1, first.line - 3), first.line + 3] });
  return { counts: result.counts, error: { path: first.path, line: first.line, message: first.message.slice(0, 1000) }, context: text, truncated: result.truncated };
}`,
};
