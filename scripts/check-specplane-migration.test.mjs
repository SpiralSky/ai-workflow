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


test('explicitly allowed new auth file must still match its recorded after hash',t=>{
  const root=snapshot(t);fs.appendFileSync(path.join(root,'packages/llm/src/chatgpt-auth.ts'),'\n// unauthorized change\n');
  assert.throws(()=>verifyPreservation(root),/Preserved content changed/);
});
test('allowed new file cannot disappear from the tracked snapshot',t=>{
  const root=snapshot(t);const file='packages/runner/src/llm-broker.ts';fs.unlinkSync(path.join(root,file));git(root,'add','-u');
  assert.throws(()=>verifyPreservation(root),/added or missing paths/);
});
test('development allowance cannot rewrite a baseline before state',t=>{
  const root=snapshot(t);const file=path.join(root,'.specplane/development-allowances.json');const data=JSON.parse(fs.readFileSync(file));
  data.changes.find(c=>c.before).before.sha256='0'.repeat(64);fs.writeFileSync(file,JSON.stringify(data));
  assert.throws(()=>verifyPreservation(root),/before-state mismatch/);
});
test('original inventory content remains anchored after feature development',t=>{
  const root=snapshot(t);fs.appendFileSync(path.join(root,'.specplane/migration-runtime-inventory.json'),' ');
  assert.throws(()=>verifyPreservation(root),/Original migration inventory was rewritten/);
});
test('development allowances cannot introduce benchmark fixture changes',t=>{
  const root=snapshot(t);const file=path.join(root,'.specplane/development-allowances.json');const data=JSON.parse(fs.readFileSync(file));
  data.changes.push({path:'experiments/unauthorized.py',before:null,after:{path:'experiments/unauthorized.py',mode:'100644',sha256:'0'.repeat(64)},rationale:'not part of signin'});fs.writeFileSync(file,JSON.stringify(data));
  assert.throws(()=>verifyPreservation(root),/did not match/);
});
test('development plans cannot become ready through the integration',t=>{
  const root=snapshot(t);const file=path.join(root,'plans/2026-11-01-openai-plan-signin/PLAN.md');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('status: draft','status: ready'));
  assert.throws(()=>verifyPreservation(root),/must remain draft/);
});

test('packaged sidecar bytes cannot drift from the recorded runtime after state',t=>{
  const root=snapshot(t);fs.appendFileSync(path.join(root,'packages/server/dist/python/aiw_sidecar/rpc.py'),'\n# unauthorized\n');
  assert.throws(()=>verifyPreservation(root),/Preserved content changed/);
});
test('minimal Docker build context whitelist cannot silently expand',t=>{
  const root=snapshot(t);fs.appendFileSync(path.join(root,'experiments/docker/aiw-base/Dockerfile.dockerignore'),'\n!.env\n');
  assert.throws(()=>verifyPreservation(root),/Preserved content changed/);
});

test('reviewed ignore hygiene cannot be silently weakened',t=>{
  const root=snapshot(t);fs.appendFileSync(path.join(root,'.gitignore'),'\n!.env\n');
  assert.throws(()=>verifyPreservation(root),/Preserved content changed/);
});

test('runtime hygiene helper cannot be silently weakened',t=>{
  const root=snapshot(t);fs.appendFileSync(path.join(root,'scripts/check-runtime-gitignore.sh'),'\n# unauthorized weakening\n');
  assert.throws(()=>verifyPreservation(root),/Preserved content changed/);
});

test('reconstructed corpus rejects missing extra content and executable mode drift',t=>{
 for(const kind of ['missing','extra','content','mode']){const root=snapshot(t),rel='experiments/native-dev/calendar-window/TASK.md',file=path.join(root,rel);
  if(kind==='missing')fs.unlinkSync(file);
  if(kind==='extra'){fs.writeFileSync(path.join(root,'experiments/native-dev/unlisted.py'),'# not authorized');git(root,'add','experiments/native-dev/unlisted.py');}
  if(kind==='content')fs.appendFileSync(file,'changed task');
  if(kind==='mode')fs.chmodSync(file,0o755);
  assert.throws(()=>verifyPreservation(root),kind==='extra'?/Tracked inventory/:kind==='missing'?/ENOENT/:kind==='mode'?/mode changed/:/Preserved content changed/);
 }
});
test('reconstructed declaration cannot authorize unlisted paths or transplant another fixture hash',t=>{
 const root=snapshot(t),file=path.join(root,'.specplane/native-reconstruction-inventory.json'),data=JSON.parse(fs.readFileSync(file));
 data.changes[0].after.sha256=data.changes[1].after.sha256;fs.writeFileSync(file,JSON.stringify(data));
 assert.throws(()=>verifyPreservation(root),/declaration changed/);
 data.changes[0].path='experiments/native-dev/unlisted.py';data.changes[0].after.path=data.changes[0].path;fs.writeFileSync(file,JSON.stringify(data));
 assert.throws(()=>verifyPreservation(root),/declaration changed/);
});
