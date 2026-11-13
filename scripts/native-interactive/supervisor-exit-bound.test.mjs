import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {registerHooks} from 'node:module';
// No real worker/OS signal/runtime inspection. Hooks substitute only environment
// dependencies; all supervise failure/cleanup/result logic is the actual source.
const hooks=registerHooks({load(url,context,next){
 const result=next(url,context);
 if(url.endsWith('/check-runtime.mjs'))return {...result,source:`export const checkRuntimePolicy=()=>({lockSHA256:'synthetic'});export const inspectCheckRuntime=()=>({sources:{'offline_check_runtime.json':{sha256:'synthetic'}}});export const nativeCheckEnv=()=>({});export const verifyCellCheckRuntime=()=>{throw Error("unexpected runtime verification");};`};
 if(url.endsWith('/cli.mjs'))return {...result,source:String(result.source).replace('const child=spawn(', 'const child=globalThis.__fakeSpawn(').replaceAll('process.kill(', 'globalThis.__fakeKill(')};
 return result;
}});
const {supervise}=await import('./cli.mjs');
const {snapshotSubmission}=await import('./coordinator.mjs');
const {NATIVE_LIMITS_MANIFEST}=await import('./completion-lane.mjs');
const evidenceRoot=process.env.AIW_EXIT_EVIDENCE??os.tmpdir();
function fixture(arm='direct'){const cellDir=fs.mkdtempSync(path.join(evidenceRoot,'supervisor-exit-bound-'));const root=path.join(cellDir,'workspace'),venv=path.join(cellDir,'venv');fs.mkdirSync(root);fs.mkdirSync(venv);const config={arm,root,allowedWritePaths:[],venv,cellDir,journalDir:path.join(cellDir,'journal')};fs.writeFileSync(path.join(cellDir,'config.json'),JSON.stringify(config));fs.writeFileSync(path.join(cellDir,'admission.json'),JSON.stringify({config,...(arm==='direct'?{}:{evidenceMode:'synthetic-control',checkRuntimePolicy:{lockSHA256:'synthetic'},bindings:{},nativeCompletionLimits:NATIVE_LIMITS_MANIFEST})}));if(arm!=='direct')fs.writeFileSync(path.join(cellDir,'assignment.json'),JSON.stringify({actorId:'synthetic-no-actor'}));return config;}
function fakeChild(){const child=new EventEmitter();child.pid=987654321;child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdio=[child.stdin,child.stdout,child.stderr,new PassThrough()];child.unrefs=0;child.unref=()=>child.unrefs++;return child;}
const clock={now:()=>performance.now(),setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,10)),clearTimeout};
test('full supervisor fake EPERM/no exit writes incomplete result and rejects reuse',async()=>{
 const config=fixture(),child=fakeChild();globalThis.__fakeSpawn=()=>child;globalThis.__fakeKill=()=>{const error=Error('synthetic EPERM');error.code='EPERM';throw error;};
 const result=await supervise(config,{input:new PassThrough(),stdout(){throw Error('unexpected output');},stderr(){},clock});
 assert.equal(result.status,'incomplete');assert.equal(result.cleanup,'uncertain');assert.equal(result.workerTermination.status,'exit-unobserved-after-failure');assert.equal(result.workerTermination.exitObserved,false);assert.ok(result.killErrors.some(e=>e.code==='EPERM'));assert.equal(child.unrefs,1);assert.match(result.reason,/wall timeout/);
 const file=path.join(config.cellDir,'supervisor-result.json'),before=fs.readFileSync(file);
 child.emit('exit',0,null);child.emit('close');child.emit('error',Error('late'));await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(fs.readFileSync(file),before);assert.equal(result.workerTermination.exitObserved,false);
 await assert.rejects(supervise(config,{clock}),/already attempted/);
 assert.throws(()=>snapshotSubmission({cellDir:config.cellDir}),/unclean supervision/);
 assert.equal(fs.existsSync(path.join(config.cellDir,'submission-result.json')),false);
 console.log(JSON.stringify({case:'EPERM/no-exit',retainedCellDir:config.cellDir}));
});
test('full supervisor fake kill with observed exit still preserves failure',async()=>{
 const config=fixture(),child=fakeChild();globalThis.__fakeSpawn=()=>child;globalThis.__fakeKill=(pid,signal)=>{if(signal===0){const error=Error('absent');error.code='ESRCH';throw error;}queueMicrotask(()=>{child.emit('exit',null,'SIGKILL');child.emit('close');});};
 const result=await supervise(config,{input:new PassThrough(),stdout(){},stderr(){},clock});
 assert.equal(result.workerTermination.exitObserved,true);assert.equal(result.status,'incomplete');assert.equal(result.cleanup,'uncertain');assert.equal(result.exitSignal,'SIGKILL');assert.equal(child.unrefs,0);
 console.log(JSON.stringify({case:'kill/exit',retainedCellDir:config.cellDir}));
});
test.after(()=>{hooks.deregister();delete globalThis.__fakeSpawn;delete globalThis.__fakeKill;});

test('orchestrate failure flood has bounded kill attempts/evidence and unclosed completion lane',async()=>{
 const config=fixture('orchestrate-off'),child=fakeChild();let signals=0;
 globalThis.__fakeSpawn=()=>child;globalThis.__fakeKill=(_pid,signal)=>{if(signal==='SIGKILL')signals++;const error=Error('synthetic signal denied');error.code='E'.repeat(1000);throw error;};
 const running=supervise(config,{input:new PassThrough(),stdout(){},stderr(){},clock});
 child.stderr.emit('data',Buffer.alloc(65537));
 for(let i=0;i<2000;i++){child.stderr.emit('data',Buffer.alloc(65537));child.stdout.emit('data',Buffer.from('ignored'));child.stdio[3].emit('data',Buffer.from('ignored'));child.stdin.emit('error',Error('late stream error'));}
 const result=await running;
 assert.equal(result.status,'incomplete');assert.equal(result.cleanup,'uncertain');assert.equal(result.completionLane.closed,false);assert.equal(result.actionReceipts,undefined);
 assert.equal(result.killAttempts,2);assert.equal(signals,2);assert.equal(result.killErrors.length,2);assert.ok(result.killErrors.every(e=>e.code.length<=64));assert.equal(result.bytesErr,65537);
 assert.throws(()=>snapshotSubmission({cellDir:config.cellDir}),/unclean supervision/);
 console.log(JSON.stringify({case:'orchestrate-2000-event-flood',retainedCellDir:config.cellDir,killAttempts:result.killAttempts,killErrors:result.killErrors.length}));
});
test('stderr callback already in flight may finish but queued callback cannot start after terminalization',async()=>{
 const config=fixture('orchestrate-on'),child=fakeChild();let release,calls=0;
 globalThis.__fakeSpawn=()=>child;globalThis.__fakeKill=()=>{const error=Error('denied');error.code='EPERM';throw error;};
 const running=supervise(config,{input:new PassThrough(),stdout(){},stderr(){calls++;return new Promise(resolve=>{release=resolve;});},clock});
 child.stderr.emit('data',Buffer.from('first'));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 child.stderr.emit('data',Buffer.from('second'));
 const result=await running;assert.equal(result.status,'incomplete');assert.equal(result.cleanup,'uncertain');assert.equal(result.completionLane.closed,false);
 const resultPath=path.join(config.cellDir,'supervisor-result.json'),before=fs.readFileSync(resultPath);release();await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.deepEqual(fs.readFileSync(resultPath),before);
 console.log(JSON.stringify({case:'orchestrate-deferred-stderr',retainedCellDir:config.cellDir}));
});
test('stdout already in flight cannot create later output after failure terminalization',async()=>{
 const config=fixture('orchestrate-off'),child=fakeChild();let release,calls=0;
 globalThis.__fakeSpawn=()=>child;globalThis.__fakeKill=()=>{const error=Error('denied');error.code='EPERM';throw error;};
 const running=supervise(config,{input:new PassThrough(),stdout(){calls++;return new Promise(resolve=>{release=resolve;});},stderr(){},clock});
 child.stdout.emit('data',Buffer.from('{"kind":"ready"}\n'));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 child.stdout.emit('data',Buffer.from('{"kind":"ignored"}\n'));
 const result=await running;assert.equal(result.status,'incomplete');assert.equal(result.cleanup,'uncertain');assert.equal(result.completionLane.closed,false);
 const resultPath=path.join(config.cellDir,'supervisor-result.json'),before=fs.readFileSync(resultPath);release();await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.deepEqual(fs.readFileSync(resultPath),before);
 console.log(JSON.stringify({case:'orchestrate-deferred-stdout',retainedCellDir:config.cellDir}));
});
