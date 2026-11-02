import type { HotPathSnippet } from "./types.ts";

/** Input: state.path (relative file path with a literal alphanumeric/dot/dash/underscore basename). */
export const snippet: HotPathSnippet = {
  id: "read-not-found-locate",
  description: "Read a file; after file not found locate the exact basename in the workspace and read only a unique untruncated result.",
  tools: ["readFile", "findFiles"],
  outcome: "not-found",
  code: String.raw`async (tools, state) => {
  const safePath = (p) => typeof p === "string" && p.length > 0 && p.length <= 512 && !/^[\\/]|^[A-Za-z]:|[\x00-\x1f\x7f\\]/.test(p) && !p.split("/").includes("..");
  const { path } = state;
  if (!safePath(path) || /(?:^|\/)\.?$/.test(path)) throw new Error("invalid file path");
  const name = path.split("/").pop();
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name === "." || name === "..") throw new Error("invalid literal filename");
  try { return { path, text: await tools.readFile({ path, range: [1, 80] }) }; }
  catch (error) {
    if (!/\bENOENT\b/.test(String(error))) throw error;
    const found = await tools.findFiles({ pattern: name, path: "." });
    if (found.truncated || found.files.length !== 1) return { found: false, candidates: found.files.slice(0, 20), omittedVisible: Math.max(0, found.files.length - 20), truncated: found.truncated };
    const located = found.files[0];
    if (!safePath(located) || located.split("/").pop() !== name) throw new Error("invalid located path");
    return { path: located, text: await tools.readFile({ path: located, range: [1, 80] }) };
  }
}`,
};
