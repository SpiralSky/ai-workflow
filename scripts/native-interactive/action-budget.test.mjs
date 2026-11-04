import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {LIMITS,LOCAL_WATCHDOGS,digest} from './protocol.mjs';
import {NATIVE_COMPLETION_LIMITS,NATIVE_COMPLETION_CLOCK_POLICY,createNativeCompletionBridge,encodeNative,parseNativeCompletionFrame,nativeCompletionPaths,verifyNativeCompletionLifetime,nativeRemainingLifetime} from './native-completion.mjs';
import {NATIVE_COMPLETION_BOOTSTRAP_LIMITS} from './native-completion-bootstrap.mjs';
import {NATIVE_COMPLETION_CAPTURE_LIMITS} from './native-completion-capture.mjs';
import {ACTOR_DATA_LIMITS} from './actor-data.mjs';
import {NATIVE_LIMITS_MANIFEST,completionBinding} from './completion-lane.mjs';
import {validateConfig} from './cli.mjs';
import {PUBLIC_HANDOFF_TEMPLATE} from './handoff.mjs';
import {captureThroughFixedHelpers,finalizeFixedHelperRelay,createFixedTransportTestBinding} from './completion-helper-test-support.mjs';

const root=process.env.NATIVE_TEST_EVIDENCE??os.tmpdir();
const request={system:'Synthetic no-model budget control.',messages:[],tools:[]};
/** Retain every synthetic cell and its helper observations, including failures. */
function fixture({arm='orchestrate-off',remainingMs=LIMITS.actionMs,...overrides}={}){
 const base=fs.mkdtempSync(path.join(root,'action-budget-')),cellDir=path.join(base,'cell');fs.mkdirSync(cellDir);
 const binding=createFixedTransportTestBinding({cellDir,cellId:'cell',arm,limitsSHA256:digest(NATIVE_LIMITS_MANIFEST)});
 const emitted=[],faults=[],abort=new AbortController();
 const bridge=createNativeCompletionBridge({cellDir,binding,issueCapability:async()=>randomBytes(32).toString('hex'),emitRequest:raw=>{emitted.push(raw);},onFatal:e=>faults.push(e.message),checkActive(){},...overrides});
 bridge.open();bridge.beginAction(1,remainingMs);
 return {base,cellDir,binding,bridge,emitted,faults,abort};
}
/** Advance only the owner's monotonic observation; real helpers keep real same-boot clocks. */
function ownerClock(t){let now=1000000;t.mock.method(process.hrtime,'bigint',()=>BigInt(now)*1000000n);return {now:()=>now,advance:ms=>{now+=ms;}};}
/** Observe a new request without delaying or renewing any production deadline. */
async function issue(f){
 const index=f.emitted.length;
 const result=f.bridge.client.complete({...request,signal:f.abort.signal}).then(value=>({ok:true,value}),error=>({ok:false,error}));
 for(let n=0;n<20&&f.emitted.length===index;n++)await Promise.resolve();
 assert.equal(f.emitted.length,index+1);const raw=f.emitted[index],frame=parseNativeCompletionFrame(raw);
 const {request:payload,...envelope}=frame;
 return {result,frame,reply:encodeNative({...envelope,version:'native-completion-response-v1',message:{role:'assistant',content:'Synthetic accepted bytes.'}})};
}
/** Capture through unchanged fixed children, accept, and independently reconstruct evidence. */
async function accept(f,p){await captureThroughFixedHelpers(f,p.frame.completionSequence,p.reply);f.bridge.accept(p.reply);await finalizeFixedHelperRelay(f,p.frame.completionSequence);assert.equal((await p.result).ok,true);}

test('300/300/900 profile changes only whole-action/request bounds and preserves independent watchdogs',()=>{
 assert.deepEqual(LIMITS,{assignmentMs:900000,actionMs:300000,rounds:12,hostCalls:60,lineBytes:98304,sourceBytes:32768,referenceReadBytes:65536,feedbackBytes:1048576});
 assert.deepEqual(NATIVE_COMPLETION_LIMITS,{attempts:32,frameBytes:98304,totalBytes:1048576,requestMs:300000,depth:32,sourceBytes:32768,calls:16});
 assert.deepEqual(LOCAL_WATCHDOGS,{publicBootstrapMs:60000,cleanupMs:60000,branchExecutionMs:60000});
 for(const limits of [NATIVE_COMPLETION_BOOTSTRAP_LIMITS,NATIVE_COMPLETION_CAPTURE_LIMITS,ACTOR_DATA_LIMITS])assert.equal(limits.timeoutMs,60000);
 assert.equal(NATIVE_COMPLETION_CLOCK_POLICY.samplingSkewMs,20);assert.equal(NATIVE_COMPLETION_CLOCK_POLICY.precisionMarginMs,20);assert.equal(NATIVE_COMPLETION_CLOCK_POLICY.maxElapsedDriftMs,60);
 assert.match(PUBLIC_HANDOFF_TEMPLATE,/900 seconds from supervisor launch through close/);assert.match(PUBLIC_HANDOFF_TEMPLATE,/300-second ceiling/);assert.match(PUBLIC_HANDOFF_TEMPLATE,/later requests never restart the action clock/);
 const bindings=['orchestrate-off','orchestrate-on'].map(arm=>completionBinding({bindings:{synthetic:true},arm},digest('admission'),'cell'));
 assert.equal(bindings[0].limitsSHA256,bindings[1].limitsSHA256);
 const old=structuredClone(NATIVE_LIMITS_MANIFEST);old.action.actionMs=60000;old.completion.requestMs=60000;
 assert.notEqual(digest(old),bindings[0].limitsSHA256);
});

for(const arm of ['orchestrate-off','orchestrate-on'])test(`one original action spans three completions beyond 60s (${arm})`,async t=>{
 const clock=ownerClock(t),f=fixture({arm});let pending;
 try{
  const first=pending=await issue(f);assert.equal(first.frame.deadlineMonotonicMs,clock.now()+300000);
  const originalDeadline=first.frame.deadlineMonotonicMs;await accept(f,first);
  clock.advance(60001);const second=pending=await issue(f);assert.equal(second.frame.deadlineMonotonicMs,originalDeadline);await accept(f,second);
  clock.advance(179999);const third=pending=await issue(f);assert.equal(third.frame.deadlineMonotonicMs,originalDeadline);
  const lease=verifyNativeCompletionLifetime({cellDir:f.cellDir,sequence:3});assert.equal(lease.remainingMs,60000);
  clock.advance(59999);await accept(f,third);f.bridge.endAction();const evidence=f.bridge.close();assert.equal(evidence.accepted.length,3);assert.equal(f.faults.length,0);
  fs.writeFileSync(path.join(f.base,'owner-clock-observations.json'),encodeNative({scope:'synthetic owner clock only; actual fixed helpers used real shared clocks',originalDeadline,completionDeadlines:f.emitted.map(raw=>parseNativeCompletionFrame(raw).deadlineMonotonicMs),acceptedAt:clock.now(),evidence}));
 }finally{f.abort.abort();if(pending)await pending.result;}
});

for(const elapsed of [300000,300001])test(`late bridge response at ${elapsed}ms cannot complete even before timer callback`,async t=>{
 const clock=ownerClock(t),f=fixture();let pending;
 try{pending=await issue(f);clock.advance(elapsed);assert.throws(()=>f.bridge.accept(pending.reply),/deadline/);assert.equal((await pending.result).ok,false);assert.equal(f.faults.length,1);assert.throws(()=>f.bridge.verifyComplete());assert.equal(fs.existsSync(nativeCompletionPaths(f.cellDir,1).response),false);}
 finally{f.abort.abort();if(pending)await pending.result;}
});

test('in-flight cancellation after 60s is sticky and refuses a late helper or response',async t=>{
 const clock=ownerClock(t),f=fixture();const p=await issue(f);clock.advance(60001);f.abort.abort();const result=await p.result;
 assert.equal(result.ok,false);assert.match(result.error.message,/cancelled/);assert.throws(()=>f.bridge.accept(p.reply),/cancelled/);assert.equal(f.faults.length,1);assert.throws(()=>f.bridge.open(),/cancelled/);
});

test('request ceiling accepts max, rejects max+1 and all invalid/widening overrides',()=>{
 for(const value of [300000,60000,1]){const f=fixture({limits:{requestMs:value}});f.bridge.endAction();f.bridge.close();}
 for(const value of [300001,0,-1,1.5,NaN,Infinity])assert.throws(()=>fixture({limits:{requestMs:value}}),/limit widening/);
 assert.throws(()=>fixture({limits:{unexpected:1}}),/limit widening/);
});

for(const [remainingMs,requestMs,expected] of [[300000,90000,90000],[70000,300000,70000],[300001,300000,300000]])test(`reservation is min(original action, request cap): ${remainingMs}/${requestMs}`,async t=>{
 const clock=ownerClock(t),f=fixture({remainingMs,limits:{requestMs}});let p;
 try{p=await issue(f);assert.equal(p.frame.deadlineMonotonicMs,clock.now()+expected);assert.equal(verifyNativeCompletionLifetime({cellDir:f.cellDir,sequence:1}).remainingMs,expected);clock.advance(expected);assert.throws(()=>f.bridge.accept(p.reply),/deadline/);assert.equal((await p.result).ok,false);}
 finally{f.abort.abort();if(p)await p.result;}
});

test('immutable lifetime accepts exact maximum, rejects maximum+1 and altered bindings',async t=>{
 ownerClock(t);const f=fixture();let p;
 try{
  p=await issue(f);const files=nativeCompletionPaths(f.cellDir,1),original=fs.readFileSync(files.lifetime),grantOriginal=fs.readFileSync(files.grant),lease=parseNativeCompletionFrame(original),grant=parseNativeCompletionFrame(grantOriginal);
  assert.equal(verifyNativeCompletionLifetime({cellDir:f.cellDir,sequence:1}).remainingMs,300000);
  fs.writeFileSync(path.join(f.base,'lifetime-original.jsonl'),original);fs.writeFileSync(path.join(f.base,'grant-original.jsonl'),grantOriginal);
  const invalid={...lease,remainingMs:300001,expiresUptimeMs:lease.issuedUptimeMs+300001-20,expiresWallMs:lease.issuedWallMs+300001-20};const invalidRaw=encodeNative(invalid);
  fs.writeFileSync(files.lifetime,invalidRaw);fs.writeFileSync(files.grant,encodeNative({...grant,lifetimeSHA256:digest(invalidRaw)}));
  fs.copyFileSync(files.lifetime,path.join(f.base,'lifetime-max-plus-one.jsonl'));fs.copyFileSync(files.grant,path.join(f.base,'grant-max-plus-one.jsonl'));assert.throws(()=>verifyNativeCompletionLifetime({cellDir:f.cellDir,sequence:1}),/lifetime receipt/);
  fs.writeFileSync(files.lifetime,original);fs.writeFileSync(files.grant,grantOriginal);
  const wrong=encodeNative({...lease,binding:{...lease.binding,arm:'wrong'}});fs.writeFileSync(files.lifetime,wrong);fs.writeFileSync(files.grant,encodeNative({...grant,lifetimeSHA256:digest(wrong)}));
  fs.copyFileSync(files.lifetime,path.join(f.base,'lifetime-wrong-binding.jsonl'));fs.copyFileSync(files.grant,path.join(f.base,'grant-wrong-binding.jsonl'));assert.throws(()=>verifyNativeCompletionLifetime({cellDir:f.cellDir,sequence:1}),/lifetime binding/);
 }finally{f.abort.abort();if(p)await p.result;}
});

test('longer dual-clock lifetime keeps original precision, expiry and drift tolerances',()=>{
 const lease={bootId:'synthetic-boot',issuedUptimeMs:1000,issuedWallMs:1000000,expiresUptimeMs:300980,expiresWallMs:1299980,remainingMs:300000};
 assert.equal(nativeRemainingLifetime(lease,{bootId:'synthetic-boot',uptimeMs:61001,wallUpperMs:1060001}),239979);
 assert.throws(()=>nativeRemainingLifetime(lease,{bootId:'synthetic-boot',uptimeMs:61001,wallUpperMs:1060062}),/drift/);
 assert.throws(()=>nativeRemainingLifetime(lease,{bootId:'synthetic-boot',uptimeMs:300980,wallUpperMs:1299980}),/original completion deadline/);
});

test('CLI configuration cannot replace the fixed action/request/assignment policy',()=>{
 for(const field of ['timeoutMs','requestMs','actionMs','wallTimeoutMs','limits'])for(const value of [1,60000,300000,900000,900001])assert.throws(()=>validateConfig({[field]:value}),/invalid config/);
});
