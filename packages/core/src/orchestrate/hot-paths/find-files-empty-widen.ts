import type { HotPathSnippet } from "./types.ts";

/** Inputs: state.path (workspace-relative scope), state.pattern (bounded glob). */
export const snippet: HotPathSnippet = {
  id: "find-files-empty-widen",
  description: "Find files by name with a glob; recover from an empty scoped file search by widening only to the workspace.",
  tools: ["findFiles"],
  outcome: "empty-result",
  code: String.raw`async (tools, state) => {
  const safePath = (p) => typeof p === "string" && p.length > 0 && p.length <= 512 && !/^[\\/]|^[A-Za-z]:|[\x00-\x1f\x7f\\]/.test(p) && !p.split("/").includes("..");
  const { path, pattern } = state;
  if (!safePath(path) || typeof pattern !== "string" || !pattern.trim() || pattern.length > 256 || !safePath(pattern)) throw new Error("invalid file search inputs");
  const first = await tools.findFiles({ path, pattern });
  if (first.files.length || path === ".") return { files: first.files.slice(0, 20), omittedVisible: Math.max(0, first.files.length - 20), truncated: first.truncated };
  const wider = await tools.findFiles({ path: ".", pattern });
  return { widened: true, files: wider.files.slice(0, 20), omittedVisible: Math.max(0, wider.files.length - 20), truncated: wider.truncated };
}`,
};
