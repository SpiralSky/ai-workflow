import { execFileSync } from 'node:child_process';
import { readdir, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hash } from '../dot-native/method.ts';
import { plainPath, readText } from './files.ts';

/** This reviewed candidate alone is admitted. A refinement needs explicit new review/versioning. */
export const REVIEWED_SOURCE_TREE = '5c048e2715be4dc93bc9b0bcfa354b85f971bc85';
/** Informational published identity; admission never requires a local-only commit object. */
export const REVIEWED_PUBLISHED_COMMIT = 'd75555eecef2249d3fbf5d04902d4133f039fc15';
/** Coordinator-approved sibling only; an artifact may never choose a module-execution root. */
export const REVIEWED_CATALOG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../ai-workflow-hotpath-prototype');
export interface Snippet { id: string; description: string; tools: string[]; outcome: string; code: string }
export interface CatalogSnapshot {
  kind: 'reviewed-local' | 'synthetic-contract-fixture';
  reviewedSourceTree: string; reviewedPublishedCommit: string | null; observedCheckoutCommit: string; catalogSHA256: string; sourceSHA256: Record<string, string>;
  snippets: readonly Snippet[];
  select(instruction: string, names: string[]): Snippet[];
}

/** Hash exact reviewed source bytes, not a source-supplied attestation. */
export async function hashTrees(root: string, trees: string[], files: string[] = []): Promise<Record<string, string>> {
  const paths = [...files];
  async function visit(relative: string): Promise<void> {
    for (const item of await readdir(join(root, relative), { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('symlink source rejected');
      if (item.isDirectory()) await visit(join(relative, item.name));
      else paths.push(join(relative, item.name));
    }
  }
  for (const tree of trees) await visit(tree);
  const result: Record<string, string> = {};
  for (const path of [...new Set(paths)].sort()) result[path] = hash(await readText(join(root, path), 8_388_608));
  return result;
}

const SOURCE_TREES = ['packages/core/src', 'packages/llm/src', 'packages/telemetry/src'];
const SOURCE_FILES = ['package.json', 'package-lock.json', 'packages/core/package.json', 'packages/llm/package.json',
  'packages/telemetry/package.json', 'packages/server/package.json', 'packages/server/dist/aiw-server.mjs'];

/** Read-only source-equivalence check; never imports or executes modules from this path.
 * Exported for portable temporary-Git-fixture tests. Production admission first checks the known root.
 */
export async function admitSource(root: string, reviewedSourceTree: string) {
  if (!/^[a-f0-9]{40}$/.test(reviewedSourceTree)) throw new Error('invalid reviewed source tree');
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 16_777_216 });
  if (git('rev-parse', '--show-toplevel').trim() !== root) throw new Error('unexpected catalog repository root');
  const observedCheckoutCommit = git('rev-parse', 'HEAD').trim();
  if (git('cat-file', '-t', reviewedSourceTree).trim() !== 'tree') throw new Error('reviewed source anchor must be a Git tree');
  const ancestorTrees = new Set(git('log', '--format=%T', observedCheckoutCommit).trim().split('\n'));
  if (!ancestorTrees.has(reviewedSourceTree)) throw new Error('catalog HEAD history does not contain the exact reviewed source tree');
  if (git('status', '--porcelain', '--untracked-files=normal').trim()) throw new Error('catalog checkout must be clean');
  const tree = (ref: string) => git('ls-tree', '-r', '-z', ref, '--', ...SOURCE_TREES, ...SOURCE_FILES);
  const reviewedTree = tree(reviewedSourceTree);
  if (tree(observedCheckoutCommit) !== reviewedTree) throw new Error('relevant catalog Git tree differs from reviewed source');
  const expected: Record<string, string> = {};
  for (const record of reviewedTree.split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob [a-f0-9]{40}\t(.+)$/.exec(record);
    if (!match) throw new Error('invalid reviewed catalog source entry');
    expected[match[2]] = hash(git('show', `${reviewedSourceTree}:${match[2]}`));
  }
  const actual = await hashTrees(root, SOURCE_TREES, SOURCE_FILES);
  if (JSON.stringify(Object.entries(expected).sort()) !== JSON.stringify(Object.entries(actual).sort())) {
    throw new Error('catalog working bytes differ from reviewed Git blobs');
  }
  if (git('rev-parse', 'HEAD').trim() !== observedCheckoutCommit || git('status', '--porcelain', '--untracked-files=normal').trim()) throw new Error('candidate changed during admission');
  return { reviewedSourceTree, observedCheckoutCommit, sourceSHA256: actual };
}

/** Load only the clean approved sibling, with reviewed source-equivalent Git blobs checked first.
 * This executes the actual reviewed index and normal local dependencies, never artifact modules.
 * Coordinator ownership and unchanged installed dependencies remain prerequisites.
 */
export async function loadCatalog(root: string): Promise<CatalogSnapshot> {
  if (root !== resolve(root)) throw new Error('catalog root must be an explicit absolute path');
  if (root !== REVIEWED_CATALOG_ROOT) throw new Error('catalog root is not the approved known local checkout');
  await plainPath(root);
  if (await realpath(root) !== root) throw new Error('catalog root must be canonical');
  const before = await admitSource(root, REVIEWED_SOURCE_TREE);
  const { HotPathIndex } = await import(pathToFileURL(join(root, 'packages/core/src/orchestrate/hot-paths/index.ts')).href);
  const { HOT_PATH_SEEDS } = await import(pathToFileURL(join(root, 'packages/core/src/orchestrate/hot-paths/catalog.ts')).href);
  const { hotPathCatalogFingerprint } = await import(pathToFileURL(join(root, 'packages/core/src/orchestrate/hot-paths/fingerprint.ts')).href);
  if (JSON.stringify(before) !== JSON.stringify(await admitSource(root, REVIEWED_SOURCE_TREE))) throw new Error('candidate changed while loading');
  const snippets = structuredClone(HOT_PATH_SEEDS) as Snippet[];
  const index = new HotPathIndex(snippets);
  return { kind: 'reviewed-local', ...before, reviewedPublishedCommit: REVIEWED_PUBLISHED_COMMIT,
    catalogSHA256: hotPathCatalogFingerprint(snippets), snippets,
    select(instruction, names) {
      const catalog = names.map(name => ({ name, hostName: name, description: name, parameters: { type: 'object' },
        returns: 'unknown', routing: 'routed', capsOutput: true, meta: { whenToUse: name, effect: 'read' } }));
      const selection = { tools: catalog, stages: { retrieved: [], final: names } };
      const result = index.select(instruction, selection, catalog);
      if (result.selection.tools.length !== catalog.length || result.selection.tools.some((d: { name: string }, i: number) => d.name !== names[i])) throw new Error('presentation-only pilot cannot add or reorder tools');
      return structuredClone(result.hotPaths);
    } };
}
