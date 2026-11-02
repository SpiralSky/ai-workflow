/** Independent extension avoids adjoining amendments to the shared migration regression file. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {verifyPreservation} from './check-specplane-migration.mjs';
const source = path.resolve(import.meta.dirname,'..');
const git = (root,...args) => execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe']});

/** A published-tree-only repository: no clone, alternates, source commit objects, or dependency copies. */
function snapshot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'aiw-migration-snapshot-'));
  for (const rel of git(source,'ls-files','-z').split('\0').filter(Boolean)) {
    const from=path.join(source,rel),to=path.join(root,rel); const stat=fs.lstatSync(from);
    fs.mkdirSync(path.dirname(to),{recursive:true});
    if (stat.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from),to);
    else {fs.copyFileSync(from,to);fs.chmodSync(to,stat.mode & 0o777);}
  }
  git(root,'init','-b','snapshot');
  git(root,'-c','user.name=Migration fixture','-c','user.email=fixture@example.invalid','add','--all');
  git(root,'-c','user.name=Migration fixture','-c','user.email=fixture@example.invalid','commit','-m','Published tree snapshot');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return root;
}

test('selector reuse allowance stage and immutable baseline records remain exact',t=>{
  const root=snapshot(t); verifyPreservation(root);
  const data=JSON.parse(fs.readFileSync(path.join(root,'.specplane/development-allowances.json')));
  const followup=data.selector_reuse_followup;
  assert.equal(followup.base_commit,'67b42ae04153079e84b1fdacdd0082a2e623ffc8');
  assert.equal(followup.changes.length,6);
  for (const change of followup.changes) {
    assert.deepEqual(change.after,data.changes.find(c=>c.path===change.path).after);
    if (['reuse-proof.ts','task-reuse.ts','selection-reuse.test.ts'].some(name=>change.path.endsWith('/'+name))) {
      assert.equal(change.before,null);
      assert.equal(data.changes.find(c=>c.path===change.path).before,null);
    }
  }
});
for (const file of ['packages/core/src/orchestrate/selection/reuse-proof.ts',
  'packages/core/src/orchestrate/selection/task-reuse.ts','packages/core/test/selection-reuse.test.ts']) {
  test(`selector reuse tampering is rejected: ${file}`,t=>{
    const root=snapshot(t);fs.appendFileSync(path.join(root,file),'\n// unauthorized tamper\n');
    assert.throws(()=>verifyPreservation(root),/Preserved content changed/);
  });
}
test('selector reuse draft cannot be promoted through experimental allowances',t=>{
  const root=snapshot(t); const file=path.join(root,'plans/2026-11-02-selector-reuse/PLAN.md');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('status: draft','status: ready'));
  assert.throws(()=>verifyPreservation(root),/Selector reuse plan must remain draft/);
});
