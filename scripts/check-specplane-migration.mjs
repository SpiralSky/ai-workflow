/** Verify the experimental migration's provenance, preserved requirements and approval boundaries. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const hash = text => createHash('sha256').update(text).digest('hex');
const git = (...args) => execFileSync('git', args, {cwd: root, encoding:'utf8'});
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
  assert.equal(hash(git('show', `${manifest.base_commit}:${entry.path}`)), entry.body_sha256);
  assert.deepEqual(fields.implements ?? [], entry.implements);
}
for (const [file, expected] of Object.entries(manifest.preserved_files)) assert.equal(hash(read(file)), expected, file);
const runtimeReference = manifest.runtime_integrity_reference ?? manifest.base_commit;
const testEntry = manifest.test_entry_allowance;
assert.equal(testEntry.path, 'packages/viewer/package.json');
const baseViewer = JSON.parse(git('show', `${runtimeReference}:${testEntry.path}`));
const currentViewer = JSON.parse(read(testEntry.path));
assert.equal(baseViewer.scripts.test, testEntry.before);
assert.equal(testEntry.after, 'node --import tsx --test test/*.test.ts');
assert.equal(currentViewer.scripts.test, testEntry.after);
currentViewer.scripts.test = baseViewer.scripts.test;
assert.deepEqual(currentViewer, baseViewer, 'Only the recorded viewer test entry may change');
assert.equal(git('diff', runtimeReference, '--', 'packages', 'framework', 'experiments', '.claude', '.claude-plugin', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.base.json', `:(exclude)${testEntry.path}`), '', 'Migration must preserve runtime and evaluation assets');
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
const cli = process.env.SPECPLANE_CLI;
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
console.log(JSON.stringify({passed:true,specs:manifest.specs.length,preservedFiles:Object.keys(manifest.preserved_files).length,baseCommit:manifest.base_commit,runtimeIntegrityReference:manifest.runtime_integrity_reference ?? manifest.base_commit,validationWarnings:warnings,cli:path.resolve(cli),cliSha256:hash(fs.readFileSync(path.resolve(cli))),planNextExit:next.status},null,2));
