// Catalog loader and BM25 retrieval for the hierarchical orchestration mode.
import { primitives } from "../catalog/primitives.js";
import { composites } from "../catalog/composites.js";
import type { ToolEntry } from "../catalog/types.js";

export type { ToolEntry };
export { primitives, composites };

// --- BM25 constants ---
const K1 = 1.5;
const B = 0.75;

const STOP_WORDS = new Set([
  "a","an","the","and","or","of","to","for","in","is","it","be","as","at","by","with",
  "from","on","are","was","this","that","have","has","not","but","can","use","used",
  "when","what","which","they","you","how","all","will","one","its","into","some",
  "than","also","if","so","do","does","get","using","more","most","any","each","very",
  "just","other","than","then","only","where","call","calls","return","returns",
]);

export interface BM25Index {
  entries: ToolEntry[];
  idf: Map<string, number>;
  tf: Array<Map<string, number>>;   // parallel to entries
  docLens: number[];
  avgLen: number;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(
    (t) => t.length > 1 && !STOP_WORDS.has(t),
  );
}

function termFreq(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return freq;
}

export function loadCatalog(): ToolEntry[] {
  return [...primitives, ...composites];
}

export function buildBM25Index(entries: ToolEntry[]): BM25Index {
  const docTokens = entries.map((e) =>
    tokenize(
      [e.searchDescription, e.useCaseSummary ?? "", ...e.tags, e.name].join(" "),
    ),
  );
  const tf = docTokens.map(termFreq);
  const docLens = docTokens.map((t) => t.length);
  const avgLen = docLens.reduce((a, b) => a + b, 0) / (docLens.length || 1);

  // IDF with BM25+ smoothing
  const df = new Map<string, number>();
  for (const freq of tf) {
    for (const token of freq.keys()) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const N = entries.length;
  const idf = new Map<string, number>();
  for (const [token, count] of df) {
    idf.set(token, Math.log((N - count + 0.5) / (count + 0.5) + 1));
  }

  return { entries, idf, tf, docLens, avgLen };
}

// Floor entries: always included regardless of score
const FLOOR_IDS = new Set(["bash", "readFile", "edit"]);

export function search(task: string, index: BM25Index, topK = 8): ToolEntry[] {
  const queryTokens = tokenize(task);
  const { entries, idf, tf, docLens, avgLen } = index;

  const scores = entries.map((_, i) => {
    let score = 0;
    for (const token of queryTokens) {
      const idfVal = idf.get(token) ?? 0;
      if (idfVal === 0) continue;
      const tfVal = tf[i].get(token) ?? 0;
      const norm = tfVal * (K1 + 1) / (tfVal + K1 * (1 - B + B * docLens[i] / avgLen));
      score += idfVal * norm;
    }
    return score;
  });

  // Collect floor entries and scored entries separately
  const floors: ToolEntry[] = [];
  const scored: Array<[ToolEntry, number]> = [];
  for (let i = 0; i < entries.length; i++) {
    if (FLOOR_IDS.has(entries[i].id)) { floors.push(entries[i]); continue; }
    scored.push([entries[i], scores[i]]);
  }
  scored.sort((a, b) => b[1] - a[1]);

  const nonFloorSlots = Math.max(0, topK - floors.length);
  const topNonFloor = scored.slice(0, nonFloorSlots).map(([e]) => e);

  // Merge: floor entries first (stable order), then top scored
  const seen = new Set(floors.map((e) => e.id));
  const result = [...floors];
  for (const e of topNonFloor) {
    if (!seen.has(e.id)) { seen.add(e.id); result.push(e); }
  }
  return result;
}

export function buildFilteredDecls(entries: ToolEntry[]): string {
  const lines: string[] = ["// Filtered tool declarations for this task"];
  for (const entry of entries) {
    if (entry.composite) {
      lines.push(entry.composite.declaration);
    } else if (entry.tsDeclaration) {
      lines.push(entry.tsDeclaration);
    }
  }
  return lines.join("\n");
}

export function buildCompositePrelude(entries: ToolEntry[]): string {
  const impls: string[] = [];
  for (const entry of entries) {
    if (entry.composite?.implementation) {
      impls.push(entry.composite.implementation);
    }
  }
  return impls.join("\n\n");
}
