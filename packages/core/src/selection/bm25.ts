/**
 * Splits text into lowercase terms: identifiers are split on camelCase and on `_`/non-alphanumerics
 * (`findFiles` → `find files`, `github_createIssue` → `github create issue`).
 * @param text - text to tokenize
 * @returns the terms, in order, duplicates kept
 */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const K1 = 1.2;
const B = 0.75;

/** In-memory BM25 index over a fixed document set. */
export class BM25Index {
  private tfs = new Map<string, Map<string, number>>();
  private lens = new Map<string, number>();
  private df = new Map<string, number>();
  private avgLen: number;

  /**
   * @param docs - documents to index; `id`s must be unique
   */
  constructor(docs: { id: string; text: string }[]) {
    let total = 0;
    for (const { id, text } of docs) {
      const tf = new Map<string, number>();
      const terms = tokenize(text);
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.tfs.set(id, tf);
      this.lens.set(id, terms.length);
      total += terms.length;
    }
    this.avgLen = docs.length ? total / docs.length || 1 : 1;
  }

  private idf(term: string): number {
    const n = this.tfs.size;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  private weight(id: string, term: string, tf: number): number {
    const len = this.lens.get(id) ?? 0;
    return this.idf(term) * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / this.avgLen)));
  }

  /**
   * Scores every document against the query.
   * @param query - free text
   * @returns one entry per matching document (score > 0), in index order
   */
  score(query: string): { id: string; score: number }[] {
    const q = [...new Set(tokenize(query))];
    const out: { id: string; score: number }[] = [];
    for (const [id, tf] of this.tfs) {
      let s = 0;
      for (const t of q) {
        const f = tf.get(t);
        if (f) s += this.weight(id, t, f);
      }
      if (s > 0) out.push({ id, score: s });
    }
    return out;
  }

  /**
   * BM25 term weights of a document (idf × saturated, length-normalised tf), for cosine similarity.
   * @param id - document id
   * @returns term → weight; empty for an unknown id
   */
  vector(id: string): Map<string, number> {
    const v = new Map<string, number>();
    for (const [t, f] of this.tfs.get(id) ?? []) v.set(t, this.weight(id, t, f));
    return v;
  }
}

/**
 * Cosine similarity of two sparse vectors.
 * @param a - first vector
 * @param b - second vector
 * @returns similarity in [0, 1] for non-negative weights; 0 if either is empty
 */
export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const [t, w] of a) {
    na += w * w;
    const o = b.get(t);
    if (o) dot += w * o;
  }
  for (const w of b.values()) nb += w * w;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
