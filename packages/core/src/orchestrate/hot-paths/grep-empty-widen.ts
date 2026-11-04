import type { HotPathSnippet } from "./types.ts";

/** Inputs: state.path (workspace-relative scope), state.pattern (nonempty regex). */
export const snippet: HotPathSnippet = {
  id: "grep-empty-widen",
  description: "Search file contents with grep; when a scoped pattern has no matches, widen only to the workspace and summarize matches.",
  tools: ["grep"],
  outcome: "empty-result",
  code: String.raw`async (tools, state) => {
  const safePath = (p) => typeof p === "string" && p.length > 0 && p.length <= 512 && !/^[\\/]|^[A-Za-z]:|[\x00-\x1f\x7f\\]/.test(p) && !p.split("/").includes("..");
  const { path, pattern } = state;
  if (!safePath(path) || typeof pattern !== "string" || !pattern.trim() || pattern.length > 256) throw new Error("invalid search inputs");
  new RegExp(pattern);
  const first = await tools.grep({ path, pattern, maxResults: 20 });
  if (first.matches.length || path === ".") return first;
  const wider = await tools.grep({ path: ".", pattern, maxResults: 20 });
  return { widened: true, ...wider };
}`,
};
