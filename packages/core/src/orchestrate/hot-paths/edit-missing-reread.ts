import type { HotPathSnippet } from "./types.ts";

/** Inputs: state.path, state.old (nonempty exact text), state.new (replacement text); no automatic re-edit. */
export const snippet: HotPathSnippet = {
  id: "edit-missing-reread",
  description: "Edit an exact string; when the old target is missing, re-read bounded current context and stop for re-anchoring instead of guessing.",
  tools: ["edit", "readFile"],
  outcome: "not-found",
  code: String.raw`async (tools, state) => {
  const safePath = (p) => typeof p === "string" && p.length > 0 && p.length <= 512 && !/^[\\/]|^[A-Za-z]:|[\x00-\x1f\x7f\\]/.test(p) && !p.split("/").includes("..");
  const { path, old, new: replacement } = state;
  if (!safePath(path) || /(?:^|\/)\.?$/.test(path) || typeof old !== "string" || !old || old.length > 8000 || typeof replacement !== "string" || replacement.length > 8000) throw new Error("invalid edit inputs");
  try { return { edited: true, change: await tools.edit({ path, old, new: replacement }) }; }
  catch (error) {
    if (!/^(Error: )?not found$/.test(String(error))) throw error;
    const context = await tools.readFile({ path, range: [1, 80] });
    return { edited: false, needsAnchor: true, context };
  }
}`,
};
