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

test('local tool secret-filter allowances do not authorize unrelated tool sources',t=>{
  const root=snapshot(t); const file=path.join(root,'.specplane/development-allowances.json'); const data=JSON.parse(fs.readFileSync(file));
  data.changes.push({path:'packages/tools/src/unrelated.ts',before:null,after:{path:'packages/tools/src/unrelated.ts',mode:'100644',sha256:'0'.repeat(64)},rationale:'outside exact secret-filter scope'});
  fs.writeFileSync(file,JSON.stringify(data));
  assert.throws(()=>verifyPreservation(root),/did not match/);
});
