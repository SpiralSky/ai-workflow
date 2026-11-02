import type { HotPathSnippet } from "./types.ts";

/** Inputs: state.path, state.start/state.end (inclusive positive line numbers, at most 80 lines). */
export const snippet: HotPathSnippet = {
  id: "read-truncated-range",
  description: "Read a large file; when the output is truncated, retrieve an explicitly requested bounded line range instead of the whole file.",
  tools: ["readFile"],
  outcome: "large-output",
  code: String.raw`async (tools, state) => {
  const safePath = (p) => typeof p === "string" && p.length > 0 && p.length <= 512 && !/^[\\/]|^[A-Za-z]:|[\x00-\x1f\x7f\\]/.test(p) && !p.split("/").includes("..");
  const { path, start, end } = state;
  if (!safePath(path) || /(?:^|\/)\.?$/.test(path) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start >= 80) throw new Error("invalid read range");
  const text = await tools.readFile({ path });
  if (!/\[truncated at line /.test(text)) return { text };
  return { narrowed: true, text: await tools.readFile({ path, range: [start, end] }) };
}`,
};
