import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {capture,inspect,processIdentity} from './workspace-recovery.mjs';
function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'recovery-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 git('init','-b','dev'); git('config','user.email','test@example.invalid');git('config','user.name','Test');
 fs.writeFileSync(path.join(root,'a'),'a');git('add','a');git('commit','-m','initial');return {root,git};
}
test('clean matching snapshot makes no writes and grants no resume permission',t=>{const {root,git}=fixture(t);const c=capture(root,'fixture');const before=git('status','--porcelain');const r=inspect(c);assert.equal(r.localMatches,true);assert.equal(r.safeToResumeAutomatically,false);assert.equal(r.external.status,'not-checked');assert.equal(git('status','--porcelain'),before);});
test('new head and branch detected without reset',t=>{const {root,git}=fixture(t);const c=capture(root,'fixture');git('switch','-c','other');fs.writeFileSync(path.join(root,'a'),'b');git('commit','-am','next');const head=git('rev-parse','HEAD');const kinds=inspect(c).findings.map(x=>x.kind);assert.ok(kinds.includes('head-mismatch'));assert.ok(kinds.includes('branch-mismatch'));assert.ok(kinds.includes('tree-mismatch'));assert.equal(git('rev-parse','HEAD'),head);});
test('missing workspace and missing expected object do not fabricate recovery',t=>{const {root}=fixture(t);const c=capture(root,'fixture');assert.ok(inspect({...c,head:'f'.repeat(40)}).findings.some(x=>x.kind==='expected-commit-unavailable'));assert.equal(inspect({...c,root:path.join(root,'gone')}).findings[0].kind,'workspace-unavailable');});
test('dirty paths are never sufficient evidence of retained contents',t=>{const {root}=fixture(t);fs.writeFileSync(path.join(root,'a'),'one');const c=capture(root,'fixture');fs.writeFileSync(path.join(root,'a'),'two');const r=inspect(c);assert.equal(r.localMatches,false);assert.ok(r.findings.some(x=>x.kind==='uncommitted-work'));});
test('missing worktree and reused PID require reconciliation',t=>{const {root}=fixture(t);const c=capture(root,'fixture');c.worktrees.push({root:path.join(root,'lost'),head:c.head,branch:c.branch});c.processes=[{pid:42,boot:'old',startTicks:'10'}];const r=inspect(c,{observeProcess:()=>({pid:42,boot:'new',startTicks:'10',state:'R'})});assert.ok(r.findings.some(x=>x.kind==='worktree-unavailable'));assert.equal(r.processes[0].status,'different-process-or-boot');});
test('present, dead and unreadable processes never imply task success',t=>{const {root}=fixture(t);const c=capture(root,'fixture');c.processes=[{pid:42,boot:'x',startTicks:'10'}];for(const [actual,status] of [[{pid:42,boot:'x',startTicks:'10',state:'S'},'present-progress-unknown'],[{pid:42,boot:'x',startTicks:'10',state:'Z'},'not-running-outcome-unknown'],[{pid:42,unavailable:true},'identity-unknown']]) assert.equal(inspect(c,{observeProcess:()=>actual}).processes[0].status,status);});
test('external observation is opt-in and unavailable is not success',t=>{const {root}=fixture(t);const c=capture(root,'fixture');assert.throws(()=>inspect(c,{remote:true}));c.external={ref:'refs/heads/dev',head:c.head};assert.equal(inspect(c,{remote:true}).external.status,'unavailable');});
test('local remote can verify recorded published tip without fetch or ref mutation',t=>{const {root,git}=fixture(t);const c=capture(root,'fixture');git('remote','add','origin',root);c.external={ref:'refs/heads/dev',head:c.head};assert.equal(inspect(c,{remote:true}).external.status,'matches-recorded-origin-ref');assert.equal(git('branch','-r').trim(),'');});
test('reject malformed checkpoints and invalid process IDs',()=>{assert.throws(()=>inspect({version:1}));assert.throws(()=>processIdentity(-1));assert.equal(processIdentity(123,'/definitely-missing').unavailable,true);});

test('detached HEAD retains commit/tree observation',t=>{const {root,git}=fixture(t);git('checkout','--detach');const c=capture(root,'fixture');assert.equal(c.branch,null);assert.equal(inspect(c).localMatches,true);});
