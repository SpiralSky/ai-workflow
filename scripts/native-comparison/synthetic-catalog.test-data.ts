import type { CatalogSnapshot, Snippet } from './catalog.ts';
import { hash } from '../dot-native/method.ts';

/** Deliberately authored synthetic unit data, not real hotpaths or a ranking implementation. */
const snippets: Snippet[] = [{ id: 'synthetic-read-only-example', description: 'Synthetic read-only example',
  tools: ['readFile'], outcome: 'unit-fixture-only', code: 'async (tools, state) => ({ sample: true })' }];
export const SYNTHETIC_CATALOG: CatalogSnapshot = {
  kind: 'synthetic-contract-fixture', reviewedSourceTree: 'synthetic-no-git-tree', reviewedPublishedCommit: null, observedCheckoutCommit: 'synthetic-no-git-commit', catalogSHA256: hash(JSON.stringify(snippets)),
  sourceSHA256: {}, snippets,
  select() { return structuredClone(snippets); },
};
