import { relPath } from "./paths.ts";

/** Change summary returned by write tools (tools §4). */
export interface ChangeSummary {
  files: { path: string; added: number; removed: number }[];
  /** Unified diff, only when small. */
  diff?: string;
}

/** Largest diff text included in a summary, in bytes. */
export const MAX_DIFF_BYTES = 2048;

type Op = { t: " " | "+" | "-"; line: string };

/** Splits text into lines without the trailing empty element of a final newline. */
function lines(text: string): string[] {
  if (text === "") return [];
  const l = text.split("\n");
  if (l[l.length - 1] === "") l.pop();
  return l;
}

/**
 * Line diff via common prefix/suffix trimming plus an LCS table on the middle. When the middle is
 * too large for the table it degrades to delete-all/add-all (counts stay correct as upper bounds).
 */
export function diffLines(a: string[], b: string[]): Op[] {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const am = a.slice(s, a.length - e);
  const bm = b.slice(s, b.length - e);
  const ops: Op[] = a.slice(0, s).map((line) => ({ t: " ", line }));
  if (am.length * bm.length > 4_000_000) {
    for (const line of am) ops.push({ t: "-", line });
    for (const line of bm) ops.push({ t: "+", line });
  } else {
    const w = bm.length + 1;
    const dp = new Uint32Array((am.length + 1) * w);
    for (let i = am.length - 1; i >= 0; i--)
      for (let j = bm.length - 1; j >= 0; j--)
        dp[i * w + j] = am[i] === bm[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    let i = 0, j = 0;
    while (i < am.length && j < bm.length) {
      if (am[i] === bm[j]) { ops.push({ t: " ", line: am[i]! }); i++; j++; }
      else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) ops.push({ t: "-", line: am[i++]! });
      else ops.push({ t: "+", line: bm[j++]! });
    }
    while (i < am.length) ops.push({ t: "-", line: am[i++]! });
    while (j < bm.length) ops.push({ t: "+", line: bm[j++]! });
  }
  for (const line of a.slice(a.length - e)) ops.push({ t: " ", line });
  return ops;
}

/** Renders ops as a unified diff with 3 lines of context. */
function unified(path: string, ops: Op[]): string {
  const CTX = 3;
  const changed = ops.flatMap((o, i) => (o.t === " " ? [] : [i]));
  if (changed.length === 0) return "";
  const out = [`--- a/${path}`, `+++ b/${path}`];
  // old/new line number at each op index
  const oldNo: number[] = [], newNo: number[] = [];
  let on = 1, nn = 1;
  for (const o of ops) {
    oldNo.push(on); newNo.push(nn);
    if (o.t !== "+") on++;
    if (o.t !== "-") nn++;
  }
  let k = 0;
  while (k < changed.length) {
    let from = Math.max(0, changed[k]! - CTX);
    let to = Math.min(ops.length - 1, changed[k]! + CTX);
    let m = k + 1;
    while (m < changed.length && changed[m]! - CTX <= to + 1) { to = Math.min(ops.length - 1, changed[m]! + CTX); m++; }
    const hunk = ops.slice(from, to + 1);
    const oc = hunk.filter((o) => o.t !== "+").length, nc = hunk.filter((o) => o.t !== "-").length;
    out.push(`@@ -${oc ? oldNo[from] : oldNo[from]! - 1},${oc} +${nc ? newNo[from] : newNo[from]! - 1},${nc} @@`);
    for (const o of hunk) out.push(o.t + o.line);
    k = m;
    from = to;
  }
  return out.join("\n") + "\n";
}

/**
 * Builds the change summary for one file edit.
 * @param root - absolute workspace root
 * @param abs - absolute path of the changed file
 * @param before - previous content, or null if the file is new
 * @param after - new content
 */
export function summarizeChange(root: string, abs: string, before: string | null, after: string): ChangeSummary {
  const path = relPath(root, abs);
  const ops = diffLines(lines(before ?? ""), lines(after));
  const added = ops.filter((o) => o.t === "+").length;
  const removed = ops.filter((o) => o.t === "-").length;
  const summary: ChangeSummary = { files: [{ path, added, removed }] };
  const diff = unified(path, ops);
  if (diff && Buffer.byteLength(diff) <= MAX_DIFF_BYTES) summary.diff = diff;
  return summary;
}
