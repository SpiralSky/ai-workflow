import { BM25Index } from "../../selection/bm25.ts";
import type { ToolDecl } from "../../registry/types.ts";

/** Default number of candidates retrieval keeps (orchestrate §7.1). */
export const DEFAULT_K = 20;

/** Cost assumed for tools that declare none, when breaking score ties. */
const DEFAULT_COST = 1;

const indexes = new WeakMap<ToolDecl[], BM25Index>();

/** The text of a tool that retrieval indexes: name, description, `whenToUse`, `examples`. */
function indexedText(d: ToolDecl): string {
  return [d.name, d.description, d.meta.whenToUse, ...(d.meta.examples ?? [])].join("\n");
}

/** Returns the BM25 index of a catalog, building it once per decl array. */
function indexFor(catalog: ToolDecl[]): BM25Index {
  let index = indexes.get(catalog);
  if (!index) {
    index = new BM25Index(catalog.map((d) => ({ id: d.name, text: indexedText(d) })));
    indexes.set(catalog, index);
  }
  return index;
}

/**
 * Retrieves the tools most relevant to an instruction (BM25). Only `routed` tools are candidates.
 * Equal scores are ordered by `cost` (lower first; undefined counts as 1), then name. Tools with
 * no matching term are not returned, so fewer than `k` results is normal.
 * The index is cached per `catalog` array (the registry's `decls`); pass the same array each time.
 * @param instruction - the intent text or the executor's `need`
 * @param catalog - registered tools
 * @param opts - `k` result count (default 20); `exclude` tool names to leave out
 * @returns candidates with scores, best first
 */
export function retrieve(
  instruction: string,
  catalog: ToolDecl[],
  opts: { k?: number; exclude?: ReadonlySet<string> } = {},
): { tool: ToolDecl; score: number }[] {
  const byName = new Map(catalog.map((d) => [d.name, d]));
  const cost = (d: ToolDecl) => d.meta.cost ?? DEFAULT_COST;
  return indexFor(catalog)
    .score(instruction)
    .map((s) => ({ tool: byName.get(s.id)!, score: s.score }))
    .filter(({ tool }) => tool.routing === "routed" && !opts.exclude?.has(tool.name))
    .sort((a, b) => b.score - a.score || cost(a.tool) - cost(b.tool) || (a.tool.name < b.tool.name ? -1 : 1))
    .slice(0, opts.k ?? DEFAULT_K);
}
