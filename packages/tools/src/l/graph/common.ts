import { cutList } from "../../search.ts";

export { navCall } from "../nav/common.ts";

/** Caps on list items returned by graph tools (each list also bounded by bytes via `cutList`). */
export const CAPS = {
  nodes: 40, edges: 60, callers: 30, related: 20, tests: 15, hits: 25,
  modules: 20, entryPoints: 8, publicApi: 10, largest: 6, mostConnected: 6, testFiles: 10, importEdges: 60, cycles: 10,
} as const;

/**
 * Cuts one list and collects its truncation hint, prefixed with the list's name so several lists can share one `truncated` string.
 * @param hints - hint strings collected so far (appended to)
 */
export function cutNamed<T>(name: string, items: T[], max: number, how: string, hints: string[]): T[] {
  const { kept, truncated } = cutList<T>(items, max, how);
  if (truncated) hints.push(`${name}: ${truncated}`);
  return kept;
}

/** Adds the joined hints as `truncated` when any list was cut. */
export function withHints<T extends object>(res: T, hints: string[]): T & { truncated?: string } {
  return hints.length ? { ...res, truncated: hints.join(" | ") } : res;
}
