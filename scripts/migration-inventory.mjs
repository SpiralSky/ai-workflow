/** Self-contained preservation inventories; historical Git objects provide additional verification only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

export const RUNTIME_SCOPE = ['packages','framework','experiments','.claude','.claude-plugin','package.json','package-lock.json','tsconfig.json','tsconfig.base.json'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (root,...args) => execFileSync('git',args,{cwd:root, maxBuffer:64*1024*1024});

/** Reject unsafe/duplicate paths and unsupported entries rather than weakening preservation checks. */
export function validateInventory(inventory) {
  assert.equal(inventory.version,1);
  assert.match(inventory.source_ref,/^[a-f0-9]{40}$/);
  assert.ok(Array.isArray(inventory.files) && inventory.files.length > 0);
  const paths = [];
  for (const entry of inventory.files) {
    assert.ok(typeof entry.path === 'string' && entry.path.length > 0 && !path.posix.isAbsolute(entry.path));
    assert.ok(!entry.path.split('/').some(p => p === '..' || p === '.' || !p));
    assert.ok(!entry.path.includes('\\'));
    assert.ok(['100644','100755','120000'].includes(entry.mode), `Unsupported mode: ${entry.path}`);
    assert.match(entry.sha256,/^[a-f0-9]{64}$/);
    paths.push(entry.path);
  }
  assert.equal(new Set(paths).size,paths.length,'Duplicate inventory path');
  return paths.sort();
}

/** Include index modes/stages: staged additions, removals and unresolved merges cannot disappear. */
export function trackedEntries(root, scope) {
  return git(root,'ls-files','--stage','-z','--',...scope).toString('utf8').split('\0').filter(Boolean).map(row => {
    const tab = row.indexOf('\t');
    const [mode,,stage] = row.slice(0,tab).split(' ');
    assert.equal(stage,'0','Unmerged index entries are not a preserved snapshot');
    return {path:row.slice(tab+1),mode};
  }).sort((a,b)=>a.path.localeCompare(b.path,'en'));
}

/** Git hashes symlinks by target text; normal files are checked by bytes and executable mode. */
export function workingEntry(root, file) {
  const full = path.join(root,file);
  const stat = fs.lstatSync(full);
  assert.ok(stat.isFile() || stat.isSymbolicLink(),`Not a file/symlink: ${file}`);
  const mode = stat.isSymbolicLink() ? '120000' : (stat.mode & 0o111) ? '100755' : '100644';
  const bytes = stat.isSymbolicLink() ? fs.readlinkSync(full,{encoding:'buffer'}) : fs.readFileSync(full);
  return {path:file,mode,sha256:sha256(bytes)};
}

/** Compare the complete tracked scope and actual worktree content, including unstaged modifications. */
export function verifyWorkingInventory(root, inventory, replacements = {}) {
  const expected = validateInventory(inventory);
  const tracked = trackedEntries(root,inventory.scope ?? expected);
  assert.deepEqual(tracked.map(e=>e.path).sort(),expected,'Tracked inventory contains added or missing paths');
  const indexed = new Map(tracked.map(e=>[e.path,e.mode]));
  for (const entry of inventory.files) {
    const expectedHash = replacements[entry.path] ?? entry.sha256;
    assert.equal(indexed.get(entry.path),entry.mode,`Tracked mode changed: ${entry.path}`);
    const actual = workingEntry(root,entry.path);
    assert.equal(actual.mode,entry.mode,`Working mode changed: ${entry.path}`);
    assert.equal(actual.sha256,expectedHash,`Preserved content changed: ${entry.path}`);
  }
}

/** Verify inventory provenance against history if available; missing objects never skip worktree checks. */
export function verifyHistoricalInventory(root, inventory) {
  validateInventory(inventory);
  const query = `${inventory.source_ref}^{commit}`;
  const result = execFileSync('git',['cat-file','--batch-check'],{cwd:root,input:query+'\n',encoding:'utf8'}).trim();
  if (result === `${query} missing`) return 'unavailable; verified self-contained inventory';
  assert.match(result,/^[a-f0-9]{40} commit \d+$/,'Historical reference did not resolve to a commit');
  const rows = git(root,'ls-tree','-rz',inventory.source_ref,'--',...(inventory.scope ?? inventory.files.map(e=>e.path))).toString('utf8').split('\0').filter(Boolean).map(row => {
    const tab = row.indexOf('\t'); const [mode,type,oid] = row.slice(0,tab).split(' ');
    assert.equal(type,'blob');
    return {path:row.slice(tab+1),mode,sha256:sha256(git(root,'cat-file','blob',oid))};
  });
  const sorted = entries => [...entries].sort((a,b)=>a.path.localeCompare(b.path,'en'));
  assert.deepEqual(sorted(rows),sorted(inventory.files),'Recorded source inventory differs from available historical objects');
  return 'verified historical objects and self-contained inventory';
}

/** Apply explicit reviewed development deltas without rewriting the immutable migration baseline. */
export function applyDevelopmentAllowances(root, inventory, replacements, allowances) {
  assert.equal(allowances.version,1);
  assert.equal(allowances.kind,'post-migration-development');
  assert.match(allowances.base_commit,/^[a-f0-9]{40}$/);
  assert.match(allowances.verified_development_head,/^[a-f0-9]{40}$/);
  assert.ok(Array.isArray(allowances.user_requests) && allowances.user_requests.length > 0);
  assert.ok(allowances.user_requests.every(request => typeof request === 'string' && request.trim()));
  const anchors = ['.specplane/migration-runtime-inventory.json','.specplane/migration-source-inventory.json'];
  assert.deepEqual(Object.keys(allowances.original_inventory_sha256).sort(),anchors.sort());
  for (const file of anchors) assert.equal(sha256(fs.readFileSync(path.join(root,file))),allowances.original_inventory_sha256[file],`Original migration inventory was rewritten: ${file}`);
  const expected = new Map(inventory.files.map(entry=>[entry.path,{...entry,sha256:replacements[entry.path] ?? entry.sha256}]));
  const seen = new Set();
  assert.ok(Array.isArray(allowances.changes) && allowances.changes.length > 0);
  for (const change of allowances.changes) {
    assert.ok(!seen.has(change.path),`Duplicate development allowance: ${change.path}`);seen.add(change.path);
    // Permit only the two explicit image packaging files; benchmark fixtures/permissions remain excluded.
    assert.match(change.path,/^(packages\/(core|llm|runner|server|telemetry)\/|packages\/tools\/(?:src\/(?:sidecar|env|search)\.ts|test\/env-security\.test\.ts|python\/aiw_sidecar\/(?:execution|rpc)\.py)$|package-lock\.json$|experiments\/docker\/aiw-base\/Dockerfile(?:\.dockerignore)?$)/);
    assert.ok(typeof change.rationale === 'string' && change.rationale.trim());
    assert.deepEqual(change.before,expected.get(change.path) ?? null,`Development before-state mismatch: ${change.path}`);
    assert.ok(change.after,'This bounded development scope does not authorize deleting baseline runtime files');
    validateInventory({version:1,source_ref:inventory.source_ref,files:[change.after]});
    assert.equal(change.after.path,change.path);
    assert.notDeepEqual(change.before,change.after,`Unnecessary development allowance: ${change.path}`);
    expected.set(change.path,change.after);
  }
  assert.deepEqual([...allowances.draft_plans].sort(),['plans/2026-11-01-all-provider-host-broker/PLAN.md','plans/2026-11-01-classifier-evaluation/PLAN.md','plans/2026-11-01-direct-deepseek/PLAN.md','plans/2026-11-01-direct-typesafe-classifier/PLAN.md','plans/2026-11-01-failfast-campaign/PLAN.md','plans/2026-11-01-openai-plan-signin/PLAN.md','plans/2026-11-01-provenance-readiness/PLAN.md','plans/2026-11-01-tool-env-secrets/PLAN.md','plans/2026-11-01-typed-classifier-reranker/PLAN.md']);
  for (const file of allowances.draft_plans) {
    assert.match(file,/^plans\/2026-11-01-(all-provider-host-broker|classifier-evaluation|direct-deepseek|direct-typesafe-classifier|failfast-campaign|openai-plan-signin|provenance-readiness|tool-env-secrets|typed-classifier-reranker)\/PLAN\.md$/);
    const text=fs.readFileSync(path.join(root,file),'utf8');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    assert.ok(frontmatter,`Missing development plan frontmatter: ${file}`);
    assert.match(frontmatter[1],/^status: draft\r?$/m,`Development plan must remain draft: ${file}`);
  }
  if (allowances.hygiene_metadata) {
    assert.deepEqual(allowances.hygiene_metadata.files.map(e=>e.path).sort(), [".gitignore","docs/dot-progress/ignore-hygiene.md","docs/dot-progress/runtime-hygiene-followup.md","scripts/check-gitignore.sh","scripts/check-runtime-gitignore.sh"]);
    verifyWorkingInventory(root, allowances.hygiene_metadata);
  }
  // Exact reviewed new corpus only. Never rewrite/relax original runtime or benchmark inventories.
  const nativeBytes=fs.readFileSync(path.join(root,'.specplane/native-reconstruction-inventory.json'));
  assert.equal(sha256(nativeBytes),'1a34fdb4a25ebdeffe8667f6d21aa1990a5aba1c649ef951cb013d2bd58aa541','Reconstructed fixture declaration changed');
  const native=JSON.parse(nativeBytes);
  assert.equal(native.version,1);assert.equal(native.kind,'reconstructed-noncanonical-fixtures');
  assert.equal(native.source_commit,'e2d26b00acad5fd42ff7355f2b628c02f02d013b');assert.equal(native.canonicalCampaign,false);
  assert.equal(native.changes.length,25);
  for(const entry of native.changes){
    assert.equal(entry.before,null);assert.ok(!expected.has(entry.path),'Reconstruction cannot replace baseline paths');
    assert.equal(entry.after.path,entry.path);validateInventory({version:1,source_ref:native.source_commit,files:[entry.after]});
    expected.set(entry.path,entry.after);
  }
  // Separately reviewed native-only checker delta; the migration and fixture baselines remain immutable.
  const offlineBytes=fs.readFileSync(path.join(root,'.specplane/native-offline-check-inventory.json'));
  assert.equal(sha256(offlineBytes),'1b5debc210c407fe636f86f1e6469bd1efadefdbb260167d39bd2d68a67833da','Native offline checker declaration changed');
  const offline=JSON.parse(offlineBytes);
  assert.equal(offline.version,1);assert.equal(offline.kind,'native-offline-check-adaptation');
  assert.equal(offline.base_commit,'b768e012e69008aacb1aec1e09014bc41837a182');assert.equal(offline.canonicalCampaign,false);
  const offlinePaths=["packages/server/dist/python/aiw_sidecar/check.py", "packages/server/dist/python/aiw_sidecar/offline_check.py", "packages/server/dist/python/aiw_sidecar/offline_check_runtime.json", "packages/tools/python/aiw_sidecar/check.py", "packages/tools/python/aiw_sidecar/offline_check.py", "packages/tools/python/aiw_sidecar/offline_check_runtime.json", "packages/tools/test/offline-check.test.py"];
  assert.deepEqual(offline.changes.map(change=>change.path).sort(),offlinePaths,'Native offline checker scope changed');
  for(const change of offline.changes){
    assert.deepEqual(change.before,expected.get(change.path)??null,`Native offline checker before-state mismatch: ${change.path}`);
    assert.ok(change.after,'Native offline checker adaptation cannot delete preserved files');
    assert.equal(change.after.path,change.path);assert.equal(change.after.mode,'100644');
    validateInventory({version:1,source_ref:offline.base_commit,files:[change.after]});
    assert.notDeepEqual(change.before,change.after,`Unnecessary native offline checker delta: ${change.path}`);
    expected.set(change.path,change.after);
  }
  return {...inventory,files:[...expected.values()]};
}
