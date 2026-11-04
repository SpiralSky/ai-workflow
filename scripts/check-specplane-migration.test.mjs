import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {verifyPreservation} from './check-specplane-migration.mjs';
import {runtimeAllowanceHashes} from './migration-inventory.mjs';
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
const runtimeFile='packages/core/src/framework/variant.ts';

test('snapshot-only Git repository passes full preservation without hidden source refs',t=>{
  const root=snapshot(t); const result=verifyPreservation(root);
  assert.match(result.historyVerification.source,/unavailable/);
  assert.match(result.historyVerification.runtime,/unavailable/);
  assert.equal(result.manifest.specs.length,19);
});
test('tampered runtime bytes are rejected without historical Git objects',t=>{
  const root=snapshot(t);fs.appendFileSync(path.join(root,runtimeFile),'\n// tampered\n');
  assert.throws(()=>verifyPreservation(root),/Preserved content changed/);
});
test('extra tracked runtime file is rejected',t=>{
  const root=snapshot(t);fs.writeFileSync(path.join(root,'packages/core/extra.txt'),'extra');git(root,'add','packages/core/extra.txt');
  assert.throws(()=>verifyPreservation(root),/added or missing paths/);
});
test('unstaged missing runtime file is rejected',t=>{
  const root=snapshot(t);fs.unlinkSync(path.join(root,runtimeFile));
  assert.throws(()=>verifyPreservation(root),/ENOENT/);
});
test('staged removed runtime file is rejected',t=>{
  const root=snapshot(t);fs.unlinkSync(path.join(root,runtimeFile));git(root,'add','-u');
  assert.throws(()=>verifyPreservation(root),/added or missing paths/);
});
test('runtime executable-mode changes are rejected',t=>{
  const root=snapshot(t);const file=path.join(root,runtimeFile);fs.chmodSync(file,0o755);
  assert.throws(()=>verifyPreservation(root),/mode changed/);
});
test('spec body tampering is rejected independently of hidden Git history',t=>{
  const root=snapshot(t);fs.appendFileSync(path.join(root,'docs/specifications/features/orchestrate.md'),'\nAltered requirement.\n');
  assert.throws(()=>verifyPreservation(root),/Requirement body changed/);
});
test('viewer allowance rejects unrelated package edits',t=>{
  const root=snapshot(t);const file=path.join(root,'packages/viewer/package.json');const p=JSON.parse(fs.readFileSync(file));p.description='unrelated edit';fs.writeFileSync(file,JSON.stringify(p,null,2)+'\n');
  assert.throws(()=>verifyPreservation(root),/Only the recorded viewer test entry/);
});
test('historical record missing from tracked tree is rejected even when bytes remain',t=>{
  const root=snapshot(t);git(root,'update-index','--force-remove','HANDOFF.md');
  assert.throws(()=>verifyPreservation(root),/tracked source record/);
});

test('runtime follow-on allowances cannot change baseline hashes, modes or path scope',()=>{
  const p='packages/example.ts', before='1'.repeat(64), after='2'.repeat(64);
  const inventory={version:1,source_ref:'a'.repeat(40),files:[{path:p,mode:'100644',sha256:before}]};
  const valid={version:1,base_ref:'b'.repeat(40),reason:'Independently reviewed regression fix',
    changes:[{path:p,mode:'100644',before_sha256:before,after_sha256:after}]};
  assert.deepEqual(runtimeAllowanceHashes(inventory,valid),{[p]:after});
  for (const patch of [{before_sha256:after},{mode:'100755'},{path:'packages/added.ts'},{path:'../escape'},{after_sha256:before},{after_sha256:'bad'}]) {
    assert.throws(()=>runtimeAllowanceHashes(inventory,{...valid,changes:[{...valid.changes[0],...patch}]}));
  }
  assert.throws(()=>runtimeAllowanceHashes(inventory,{...valid,changes:[...valid.changes,...valid.changes]}),/Duplicate/);
});

test('tampered allowed runtime bytes remain rejected',t=>{
  const root=snapshot(t);
  fs.appendFileSync(path.join(root,'packages/telemetry/src/wrap.ts'),'\n// tampered\n');
  assert.throws(()=>verifyPreservation(root),/Preserved content changed/);
});
