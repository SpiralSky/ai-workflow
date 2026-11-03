import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {inspectPublicAdmissionInputs} from './public-admission.mjs';

/** Small committed public fixtures only; never executes candidate Python or removes evidence. */
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-admission-control-'));
 const write=(p,text)=>{const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,text);};
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 write('package.json','{"private":true}\n');write('package-lock.json','{"lockfileVersion":3}\n');
 write('packages/core/src/example.ts','export const example = 1;\n');
 write('experiments/native-dev/example/TASK.md','Return the correct value.\n');
 write('experiments/native-dev/example/workspace/app.py','value = 0\n');
 write('experiments/native-dev/manifest.json',JSON.stringify({version:1,status:'draft',canonicalCampaign:false,fixtures:[{id:'example',taskPath:'experiments/native-dev/example/TASK.md',workspaceDir:'experiments/native-dev/example/workspace',allowedWritePaths:['app.py','tests/test_regressions.py'],publicTestTarget:'tests'}]})+'\n');
 write('.gitignore','experiments/native-dev/grade.py\n.specplane/private/\n');
 git('init','-q');git('add','.');git('-c','user.name=Synthetic Control','-c','user.email=synthetic@example.invalid','commit','-q','-m','test: synthetic public fixture');
 return {root,write,git};
}
test('public sources verify without private files or a hotpath runtime; no admission is granted',()=>{
 const f=fixture(),before=f.git('status','--porcelain');
 const result=inspectPublicAdmissionInputs(f.root);
 assert.equal(result.status,'public-inputs-verified');assert.equal(result.readyForActors,false);assert.equal(result.readyForGrading,false);
 assert.equal(result.commit,f.git('rev-parse','HEAD').trim());assert.equal(result.tree,f.git('rev-parse','HEAD^{tree}').trim());
 assert.equal(result.privateMaterialPresence,'not assessed');assert.equal(result.installedRuntimeClosure,'not assessed');
 assert.equal(result.fixtures[0].id,'example');assert.ok(result.sources['experiments/native-dev/example/workspace/app.py']);
 assert.equal(f.git('status','--porcelain'),before);assert.equal(fs.existsSync(path.join(f.root,'experiments/native-dev/grade.py')),false);
});
test('ignored private grader bytes are never opened or included in the public identity',()=>{
 const f=fixture(),before=inspectPublicAdmissionInputs(f.root),privateFile=path.join(f.root,'experiments/native-dev/grade.py');
 f.write('experiments/native-dev/grade.py','PRIVATE_SYNTHETIC_CANARY_DO_NOT_READ\n');
 const open=fs.openSync;fs.openSync=function(file,...args){assert.notEqual(path.resolve(String(file)),privateFile,'private file opened');return open.call(this,file,...args);};
 try{assert.equal(inspectPublicAdmissionInputs(f.root).sourceIdentitySHA256,before.sourceIdentitySHA256);}finally{fs.openSync=open;}
 assert.equal(before.privateMaterialPresence,'not assessed');
});
test('changed committed source and untracked fixture files fail rather than becoming verified evidence',()=>{
 const f=fixture();f.write('packages/core/src/example.ts','export const changed = true;\n');assert.throws(()=>inspectPublicAdmissionInputs(f.root),/working bytes/);
 const other=fixture();other.write('experiments/native-dev/example/workspace/untracked.py','not admitted\n');assert.throws(()=>inspectPublicAdmissionInputs(other.root),/not committed/);
});
test('a missing committed fixture file is checked even when other workspace files remain',()=>{
 const f=fixture();f.write('experiments/native-dev/example/workspace/second.py','value = 2\n');f.git('add','.');f.git('-c','user.name=Synthetic Control','-c','user.email=synthetic@example.invalid','commit','-q','-m','test: multi-file fixture');
 fs.renameSync(path.join(f.root,'experiments/native-dev/example/workspace/app.py'),path.join(f.root,'.git/retained-app.py'));
 assert.throws(()=>inspectPublicAdmissionInputs(f.root),/ENOENT/);
});
test('an untracked __proto__ fixture entry cannot disappear from the inherited inventory',()=>{
 const f=fixture();f.write('experiments/native-dev/example/workspace/__proto__','synthetic extra file\n');
 assert.throws(()=>inspectPublicAdmissionInputs(f.root),/unsupported public fixture property name/);
});
test('no git working-tree scan runs filters or reads tracked private files',()=>{
 const f=fixture();f.write('.gitattributes','*.ts filter=private-canary\n');
 f.write('private-grader.txt','PRIVATE_SYNTHETIC_VALUE\n');f.git('add','.');f.git('-c','user.name=Synthetic Control','-c','user.email=synthetic@example.invalid','commit','-q','-m','test: private and filter controls');
 const marker=path.join(f.root,'MUST_NOT_EXECUTE');
 f.git('config','filter.private-canary.clean','touch '+marker);
 f.git('config','core.fsmonitor','touch '+marker);
 f.write('private-grader.txt','CHANGED_PRIVATE_SYNTHETIC_VALUE\n');
 const open=fs.openSync,privateFile=path.join(f.root,'private-grader.txt');
 fs.openSync=function(file,...args){assert.notEqual(path.resolve(String(file)),privateFile);return open.call(this,file,...args);};
 try{const result=inspectPublicAdmissionInputs(f.root);assert.equal(result.overallCheckoutCleanliness,'not assessed');assert.equal(result.untrackedRuntimeFiles,'not assessed');}finally{fs.openSync=open;}
 assert.equal(fs.existsSync(marker),false);
});
test('aliases, unsupported committed links and invalid fixture layouts fail closed',()=>{
 const f=fixture(),alias=f.root+'-alias';fs.symlinkSync(f.root,alias);assert.throws(()=>inspectPublicAdmissionInputs(alias),/noncanonical/);
 const link=fixture();fs.symlinkSync('example.ts',path.join(link.root,'packages/core/src/alias.ts'));link.git('add','.');link.git('-c','user.name=Synthetic Control','-c','user.email=synthetic@example.invalid','commit','-q','-m','test: link control');assert.throws(()=>inspectPublicAdmissionInputs(link.root),/unsupported/);
 const invalid=fixture(),file=path.join(invalid.root,'experiments/native-dev/manifest.json'),manifest=JSON.parse(fs.readFileSync(file));manifest.fixtures[0].workspaceDir='experiments/native-dev/example/../workspace';fs.writeFileSync(file,JSON.stringify(manifest));invalid.git('add','.');invalid.git('-c','user.name=Synthetic Control','-c','user.email=synthetic@example.invalid','commit','-q','-m','test: invalid layout');assert.throws(()=>inspectPublicAdmissionInputs(invalid.root),/invalid public fixture path/);
});
test('full private admission inputs remain required by the default source gate',()=>{
 const source=fs.readFileSync(path.resolve(import.meta.dirname,'coordinator.mjs'),'utf8');
 for(const required of ['.specplane/native-reconstruction-inventory.json','.specplane/native-offline-check-inventory.json','docs/dot-progress/native-interactive-reconstruction.md','docs/dot-progress/native-hotpath-extension-plan.md','docs/dot-progress/native-action-receipt-proposal.md','docs/dot-progress/native-offline-check-adaptation.md','experiments/native-dev/grade.py'])assert.ok(source.includes(required),required);
 assert.ok(source.includes("if(mode==='full')return {bindings:sourceBindings(),candidateBinding:hotpathBinding()}"));
 assert.ok(source.includes("admissionMode:mode='full'"));
});
