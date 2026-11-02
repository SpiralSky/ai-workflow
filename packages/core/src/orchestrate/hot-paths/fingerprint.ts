import { canonicalJSON, sha256 } from "@aiw/telemetry";
import { HOT_PATH_SEEDS } from "./catalog.ts";
import type { HotPathSnippet } from "./types.ts";

/** Hidden prompt-set key shared by host expectation and observed compiled-server metadata. */
export const HOT_PATH_PROMPT_KEY = "hot-paths";

/** Fingerprint all reviewed snippet prompt text and declared dependencies, independent of input ordering.
 * The server computes this from its executed catalog; the host computes its own expected value.
 */
export function hotPathCatalogFingerprint(snippets: readonly HotPathSnippet[] = HOT_PATH_SEEDS): string {
  return sha256(canonicalJSON([...snippets].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(({ id, description, outcome, tools, code }) => ({ id, description, outcome, tools, code }))));
}
