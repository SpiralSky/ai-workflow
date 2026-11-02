import { BM25Index } from "../../selection/bm25.ts";
import type { ToolDecl } from "../../registry/types.ts";
import { complete, type Selection } from "../selection/index.ts";
import type { HotPathSnippet } from "./types.ts";

export type { HotPathSnippet } from "./types.ts";
/** Experimental prompt/tool budgets; defaults remain off. */
export const MAX_HOT_PATHS = 2;
export const MAX_HOT_PATH_ADDED_TOOLS = 6;

/** Immutable description-only retrieval index for a reviewed, generic snippet catalog. */
export class HotPathIndex {
  private readonly snippets: Map<string, HotPathSnippet>;
  private readonly index: BM25Index;

  /** Reject malformed catalogs rather than exposing incomplete recovery examples. */
  constructor(snippets: readonly HotPathSnippet[]) {
    this.snippets = new Map();
    for (const s of snippets) {
      if (!s.id || this.snippets.has(s.id) || !s.description.trim() || !s.outcome.trim() ||
          !s.tools.length || new Set(s.tools).size !== s.tools.length || s.tools.some(t => !t.trim()) ||
          !s.code.trim() || s.code.trim().split(/\r?\n/).length > 25) throw new Error(`Invalid hot path: ${s.id}`);
      this.snippets.set(s.id, { ...s, tools: [...s.tools] });
    }
    this.index = new BM25Index([...this.snippets.values()].map(s => ({ id: s.id, text: s.description })));
  }

  /** Retrieve bounded examples and add their available routed tools before locking/execution.
   * Explicit overrides bypass examples entirely. Original selection objects remain unmodified.
   */
  select(instruction: string, selection: Selection, catalog: ToolDecl[], override?: string[]): { selection: Selection; hotPaths: HotPathSnippet[] } {
    if (override !== undefined) return { selection, hotPaths: [] };
    const byName = new Map(catalog.map(d => [d.name, d]));
    const initial = new Set(selection.tools.map(d => d.name));
    let tools = selection.tools;
    const hotPaths: HotPathSnippet[] = [];
    const ranked = this.index.score(instruction).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const { id } of ranked) {
      const snippet = this.snippets.get(id)!;
      const declared = snippet.tools.map(name => byName.get(name));
      // Match the existing one-level completion contract, but never include an unusable dependency.
      if (declared.some(d => !d || d.routing !== "routed" ||
          (d.meta.requires ?? []).some(name => byName.get(name)?.routing !== "routed"))) continue;
      const added = complete(declared as ToolDecl[], catalog);
      const merged = [...tools, ...added.filter(d => !tools.some(t => t.name === d.name))];
      if (merged.filter(d => !initial.has(d.name)).length > MAX_HOT_PATH_ADDED_TOOLS) continue;
      tools = merged;
      hotPaths.push({ ...snippet, tools: [...snippet.tools] });
      if (hotPaths.length === MAX_HOT_PATHS) break;
    }
    if (!hotPaths.length) return { selection, hotPaths };
    return { selection: { tools, stages: { ...selection.stages, final: tools.map(d => d.name) } }, hotPaths };
  }
}
