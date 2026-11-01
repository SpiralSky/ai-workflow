import type { Reporter } from "@aiw/telemetry";
import type { ToolDecl } from "../../registry/types.ts";
import { complete } from "./complete.ts";
import { DEFAULT_K, retrieve } from "./retrieve.ts";
import type { Reranker } from "./rerank.ts";

export * from "./retrieve.ts";
export * from "./rerank.ts";
export * from "./complete.ts";

/** Default shortlist size after rerank (orchestrate §7.2). */
export const DEFAULT_N = 6;

/** Per-stage record of one selection, for the handoff record's `selection` field (orchestrate §8.4). */
export interface SelectionStages {
  /** Retrieval output with scores, best first. Empty for an override. */
  retrieved: { name: string; score: number }[];
  /** Names after rerank (before truncation); absent for an override. */
  reranked?: string[];
  /** Final names in order, after truncation and `requires` completion. */
  final: string[];
  /** The planner's `tools` override was used. */
  override?: boolean;
  /** The rerank answer was unusable and retrieval order was kept. */
  rerankFallback?: boolean;
}

/** The shortlist and how it came about. */
export interface Selection {
  tools: ToolDecl[];
  stages: SelectionStages;
}

/** Selection query (engine §4). */
export interface SelectQuery {
  instruction: string;
  /** Planner `tools`: skips retrieve and rerank, still completed. */
  override?: string[];
  /** Tool names to leave out (escalation: tools already present). */
  exclude?: Iterable<string>;
  /** Receives the rerank turn. */
  reporter?: Reporter;
  signal?: AbortSignal;
}

/** Retrieve, rerank, truncate, complete. */
export interface Selector {
  /**
   * @param q - instruction, optional override and exclusions
   * @param catalog - registered tools (pass the registry's `decls` array so the index is reused)
   * @returns the ordered shortlist with per-stage data
   * @throws Error naming the unknown tools when an override names tools not in the catalog
   */
  select(q: SelectQuery, catalog: ToolDecl[]): Promise<Selection>;
}

/**
 * Creates the selection pipeline: retrieve top `k`, rerank, keep top `n`, add `requires`.
 * `exclude`d tools are removed before retrieval truncation; their `requires` may still be added
 * by completion unless excluded too, so excluded names are filtered from the final list as well.
 * @param opts - `reranker`; `k` (default 20) and `n` (default 6)
 * @returns the selector
 */
export function createSelector(opts: { reranker: Reranker; k?: number; n?: number }): Selector {
  const k = opts.k ?? DEFAULT_K;
  const n = opts.n ?? DEFAULT_N;
  return {
    async select(q, catalog) {
      q.signal?.throwIfAborted();
      const exclude = new Set(q.exclude ?? []);
      const byName = new Map(catalog.map((d) => [d.name, d]));
      if (q.override) {
        const unknown = q.override.filter((name) => !byName.has(name));
        if (unknown.length) throw new Error(`Unknown tools in override: ${unknown.join(", ")}`);
        const tools = complete(q.override.map((name) => byName.get(name)!), catalog);
        return { tools, stages: { retrieved: [], final: tools.map((d) => d.name), override: true } };
      }
      const retrieved = retrieve(q.instruction, catalog, { k, exclude });
      const ctx = { reporter: q.reporter, signal: q.signal, fallback: false };
      const reranked = await opts.reranker.rerank(q.instruction, retrieved.map((r) => r.tool), ctx);
      const tools = complete(reranked.slice(0, n), catalog).filter((d) => !exclude.has(d.name));
      const stages: SelectionStages = {
        retrieved: retrieved.map((r) => ({ name: r.tool.name, score: r.score })),
        reranked: reranked.map((d) => d.name),
        final: tools.map((d) => d.name),
      };
      if (ctx.fallback) stages.rerankFallback = true;
      return { tools, stages };
    },
  };
}
