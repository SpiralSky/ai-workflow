import type { HotPathSnippet } from "./types.ts";

/** Inputs: state.path, state.old (nonempty exact text), state.new (replacement text); no automatic re-edit. */
export const snippet: HotPathSnippet = {
  id: "edit-ambiguous-reread",
  description: "Edit an exact string; when the target is ambiguous, re-read bounded context for a unique anchor without replacing all matches.",
  tools: ["edit", "readFile"],
  outcome: "ambiguous-match",
  code: String.raw`async (tools, state) => {
  const safePath = (p) => typeof p === "string" && p.length > 0 && p.length <= 512 && !/^[\\/]|^[A-Za-z]:|[\x00-\x1f\x7f\\]/.test(p) && !p.split("/").includes("..");
  const { path, old, new: replacement } = state;
  if (!safePath(path) || /(?:^|\/)\.?$/.test(path) || typeof old !== "string" || !old || old.length > 8000 || typeof replacement !== "string" || replacement.length > 8000) throw new Error("invalid edit inputs");
  try { return { edited: true, change: await tools.edit({ path, old, new: replacement }) }; }
  catch (error) {
    if (!/^(Error: )?not unique \(\d+ matches\); add context or pass all: true$/.test(String(error))) throw error;
    const context = await tools.readFile({ path, range: [1, 80] });
    return { edited: false, needsAnchor: true, context };
  }
}`,
};
