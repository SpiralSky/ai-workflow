import type { HotPathSnippet } from "./types.ts";

/** Inputs: state.path (relative source file), state.name (identifier); this pattern never performs a rename. */
export const snippet: HotPathSnippet = {
  id: "rename-zero-references",
  description: "Before renaming a symbol inspect references; when zero references are found inspect its definition and stop rather than speculatively rename.",
  tools: ["findReferences", "findDefinition"],
  outcome: "empty-result",
  code: String.raw`async (tools, state) => {
  const safePath = (p) => typeof p === "string" && p.length > 0 && p.length <= 512 && !/^[\\/]|^[A-Za-z]:|[\x00-\x1f\x7f\\]/.test(p) && !p.split("/").includes("..");
  const { path, name } = state;
  if (!safePath(path) || /(?:^|\/)\.?$/.test(path) || typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name.length > 128) throw new Error("invalid symbol inputs");
  const refs = await tools.findReferences({ path, name });
  if (refs.references.length) return { references: refs.references.slice(0, 20), omittedVisible: Math.max(0, refs.references.length - 20), truncated: refs.truncated };
  const definition = await tools.findDefinition({ path, name });
  return { needsReview: true, truncated: refs.truncated, definitions: definition.definitions.slice(0, 5), omittedVisible: Math.max(0, definition.definitions.length - 5) };
}`,
};
