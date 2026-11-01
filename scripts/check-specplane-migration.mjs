/** Verify the experimental migration's provenance, preserved requirements and approval boundaries. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {RUNTIME_SCOPE, sha256 as hash, validateInventory, trackedEntries, workingEntry, verifyWorkingInventory, verifyHistoricalInventory} from './migration-inventory.mjs';
export function verifyPreservation(root) {
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const manifest = JSON.parse(read('docs/dot-progress/migration-manifest.json'));
assert.equal(manifest.specs.length, 19);
assert.equal(hash(read(manifest.enhanced_framework.skill_path)), manifest.enhanced_framework.skill_sha256, 'Installed skill differs from verified enhanced template');
assert.equal(new Set(manifest.specs.map(s => s.id)).size, 19);
for (const entry of manifest.specs) {
  const file = read(entry.path);
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(file);
  assert.ok(match, entry.path);
  const fields = Object.fromEntries(match[1].split('\n').map(line => {
    const colon = line.indexOf(':');
    return [line.slice(0, colon), JSON.parse(line.slice(colon + 1))];
  }));
  assert.equal(fields.id, entry.id);
  assert.equal(fields.status, 'review', 'Imports must not fabricate approval');
  assert.equal(fields.migration_source_status, entry.source_status);
  assert.equal(hash(match[2]), entry.body_sha256, `Requirement body changed: ${entry.path}`);

  assert.deepEqual(fields.implements ?? [], entry.implements);
}
for (const [file, expected] of Object.entries(manifest.preserved_files)) assert.equal(hash(read(file)), expected, file);
const sourceInventory = JSON.parse(read(manifest.migration_source_inventory));
const runtimeInventory = JSON.parse(read(manifest.migration_runtime_inventory));
assert.equal(sourceInventory.source_ref,manifest.base_commit);
assert.equal(runtimeInventory.source_ref,manifest.runtime_integrity_reference);
assert.deepEqual(runtimeInventory.scope,RUNTIME_SCOPE);
const expectedSources = [...manifest.specs.map(e=>e.path),...Object.keys(manifest.preserved_files)].sort();
assert.deepEqual(validateInventory(sourceInventory),expectedSources);
const sourceTracked = trackedEntries(root,expectedSources);
assert.deepEqual(sourceTracked.map(e=>e.path).sort(),expectedSources,'Added or missing tracked source record');
for (const entry of sourceTracked) assert.equal(entry.mode,sourceInventory.files.find(e=>e.path === entry.path).mode,`Source index mode changed: ${entry.path}`);
const sourceByPath = new Map(sourceInventory.files.map(e=>[e.path,e]));
const actualSpecPaths = trackedEntries(root,['docs/specifications/features','docs/specifications/architecture'])
  .filter(e=>e.path.endsWith('.md') && !e.path.endsWith('/INFO.md')).map(e=>e.path).sort();
assert.deepEqual(actualSpecPaths,manifest.specs.map(e=>e.path).sort(),'Added or missing tracked specification');
for (const entry of manifest.specs) {
  const original = sourceByPath.get(entry.path);
  assert.equal(original.sha256,entry.body_sha256);
  assert.equal(workingEntry(root,entry.path).mode,original.mode,`Spec mode changed: ${entry.path}`);
}
for (const [file,expected] of Object.entries(manifest.preserved_files)) {
  const original = sourceByPath.get(file);
  assert.equal(original.sha256,expected);
  assert.deepEqual(workingEntry(root,file),original);
}
const testEntry = manifest.test_entry_allowance;
assert.equal(testEntry.path,'packages/viewer/package.json');
assert.equal(hash(testEntry.before_content),testEntry.before_sha256);
assert.equal(runtimeInventory.files.find(e=>e.path === testEntry.path)?.sha256,testEntry.before_sha256);
const baseViewer = JSON.parse(testEntry.before_content);
const currentViewer = JSON.parse(read(testEntry.path));
assert.equal(baseViewer.scripts.test,testEntry.before);
assert.equal(testEntry.after,'node --import tsx --test test/*.test.ts');
assert.equal(currentViewer.scripts.test,testEntry.after);
currentViewer.scripts.test=baseViewer.scripts.test;
assert.deepEqual(currentViewer,baseViewer,'Only the recorded viewer test entry may change');
verifyWorkingInventory(root,runtimeInventory,{[testEntry.path]:testEntry.after_sha256});
const historyVerification = {
  source:verifyHistoricalInventory(root,sourceInventory),
  runtime:verifyHistoricalInventory(root,runtimeInventory),
};
const config = read('.specplane/config.yaml');
assert.match(config, /require_approved_specs: none/);
assert.match(config, /status_source: git/);
assert.match(config, /dependency_mode: stack/);
assert.match(config, /forbid_architecture: true/);
assert.doesNotMatch(config, /Bash\(specplane/);
for (const group of ['features', 'architecture']) {
  assert.ok(fs.existsSync(path.join(root, `docs/specifications/${group}/INFO.md`)));
  assert.ok(!fs.existsSync(path.join(root, `docs/specifications/${group}/README.md`)));
}
const plan = read('plans/2026-11-01-specplane-migration/PLAN.md');
assert.match(plan, /^status: draft$/m);
assert.doesNotMatch(plan, /^status: (ready|done)$/m);
return {manifest,historyVerification};
}

export function verifyMigration(root, cli) {
const {manifest,historyVerification} = verifyPreservation(root);
if (!cli) throw new Error('Set SPECPLANE_CLI to the tested enhanced Specplane dist/cli.js; this check does not install or approve anything.');
const run = args => {
  const result = spawnSync(process.execPath, [path.resolve(cli), ...args], {cwd:root,encoding:'utf8'});
  if (result.error) throw result.error;
  return result;
};
const validation = run(['validate','--json']);
assert.equal(validation.status, 0, validation.stderr || validation.stdout);
const report = JSON.parse(validation.stdout);
assert.equal(report.valid, true);
const listing = run(['spec','list','--json']);
assert.equal(listing.status, 0, listing.stderr);
assert.deepEqual(JSON.parse(listing.stdout).map(s => s.id).sort(), manifest.specs.map(s => s.id).sort());
const next = run(['plan','next','2026-11-01-specplane-migration','--json']);
assert.equal(next.status, 0, next.stderr);
const nextState = JSON.parse(next.stdout);
assert.equal(nextState.effectiveStatus, 'draft');
assert.equal(nextState.action, 'none', 'Draft plan must not become executable via migration');
assert.equal(nextState.checkout, null);
assert.deepEqual(nextState.context.filter(c => c.kind === 'spec').map(c => c.id).sort(), ['feature/framework-runner','feature/harness-integration']);
const warnings = {};
for (const w of report.warnings ?? []) warnings[w.type] = (warnings[w.type] ?? 0) + 1;
return {passed:true,specs:manifest.specs.length,preservedFiles:Object.keys(manifest.preserved_files).length,baseCommit:manifest.base_commit,runtimeIntegrityReference:manifest.runtime_integrity_reference ?? manifest.base_commit,validationWarnings:warnings,cli:path.resolve(cli),cliSha256:hash(fs.readFileSync(path.resolve(cli))),planNextExit:next.status,historyVerification};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root=path.resolve(import.meta.dirname,'..');
  console.log(JSON.stringify(verifyMigration(root,process.env.SPECPLANE_CLI),null,2));
}
