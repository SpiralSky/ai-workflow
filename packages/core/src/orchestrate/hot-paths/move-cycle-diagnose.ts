import type { HotPathSnippet } from "./types.ts";

/** Inputs: state.path, state.name (identifier), state.to (relative destination); dryRun is always true. */
export const snippet: HotPathSnippet = {
  id: "move-cycle-diagnose",
  description: "Preview a symbol move without writing; if an import cycle would be created inspect scoped module dependencies and stop for a new plan.",
  tools: ["moveSymbol", "importGraph"],
  outcome: "import-cycle",
  code: String.raw`async (tools, state) => {
  const safePath = (p) => typeof p === "string" && p.length > 0 && p.length <= 512 && !/^[\\/]|^[A-Za-z]:|[\x00-\x1f\x7f\\]/.test(p) && !p.split("/").includes("..");
  const { path, name, to } = state;
  if (!safePath(path) || /(?:^|\/)\.?$/.test(path) || !safePath(to) || /(?:^|\/)\.?$/.test(to) || path === to || typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name.length > 128) throw new Error("invalid move inputs");
  try { return { preview: await tools.moveSymbol({ path, name, to, dryRun: true }) }; }
  catch (error) {
    if (!/the move would create an import cycle/.test(String(error))) throw error;
    const graph = await tools.importGraph({ module: path });
    return { needsPlan: true, cycles: graph.cycles.slice(0, 5), edges: graph.edges.slice(0, 20), omittedVisibleCycles: Math.max(0, graph.cycles.length - 5), omittedVisibleEdges: Math.max(0, graph.edges.length - 20), truncated: graph.truncated };
  }
}`,
};
