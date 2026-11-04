import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {createNativeSession} from './session.ts';
import {inspectCheckRuntime,nativeCheckEnv} from './check-runtime.mjs';
import {createNativeCompletionBridge,encodeNative,parseNativeCompletionFrame,nativeCompletionPaths,nativeSharedClock,verifyNativeCompletionLifetime,nativeRemainingLifetime} from './native-completion.mjs';
import {NATIVE_LIMITS_MANIFEST} from './completion-lane.mjs';
import {captureThroughFixedHelpers,finalizeFixedHelperRelay,createFixedTransportTestBinding} from './completion-helper-test-support.mjs';
import {LIMITS,digest,monotonicNow} from './protocol.mjs';

const evidenceRoot=process.env.NATIVE_TEST_EVIDENCE??os.tmpdir();
/** Invalid/widening overrides fail before touching any root or starting resources. */
for(const arm of ['orchestrate-off','orchestrate-on'] as const)test(`session rejects invalid/widening timing before resource access (${arm})`,async()=>{
 for(const timeoutMs of [300001,0,-1,1.5,NaN,Infinity])await assert.rejects(createNativeSession({arm,root:'/missing-budget-test-root',allowedWritePaths:[],venv:'/unused',env:{},onHostAttempt(){},timeoutMs,native:{binding:{arm}}} as any),/invalid or widening session timeout/);
});

/** Observe the real SDK transport and branch Deadline options without changing their clocks. */
async function sessionControl(t:TestContext,arm:'orchestrate-off'|'orchestrate-on',timeoutMs?:number,delayMs=0){
 const base=fs.mkdtempSync(path.join(evidenceRoot,'session-budget-')),cellDir=path.join(base,'cell'),root=path.join(cellDir,'workspace');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'public.py'),'value = 1\n');
 const venv=fs.realpathSync(path.resolve(import.meta.dirname,'../../packages/tools/.venv')),runtime=inspectCheckRuntime(venv,base);
 const binding=createFixedTransportTestBinding({cellDir,cellId:'cell',arm,limitsSHA256:digest(NATIVE_LIMITS_MANIFEST)});
 const transportTimeouts:unknown[]=[],branchTimeouts:unknown[]=[],actionTimeouts:number[]=[],completionDeadlines:number[]=[],clockObservations:unknown[]=[],faults:string[]=[];
 const originalRequest=Server.prototype.request,originalTimer=globalThis.setTimeout;
 const requestMock=t.mock.method(Server.prototype,'request',function(this:Server,...args:Parameters<typeof originalRequest>){if(args[0].method==='aiw/llm/complete')transportTimeouts.push(args[2]?.timeout);return Reflect.apply(originalRequest,this,args);});
 const timerMock=t.mock.method(globalThis,'setTimeout',(...args:Parameters<typeof setTimeout>)=>{if(new Error().stack?.includes('/branch/run.ts:'))branchTimeouts.push(args[1]);return Reflect.apply(originalTimer,globalThis,args);});
 const abort=new AbortController();let session:Awaited<ReturnType<typeof createNativeSession>>|undefined,requests=0;
 const bridge=createNativeCompletionBridge({cellDir,binding,issueCapability:async()=>randomBytes(32).toString('hex'),onFatal:error=>{faults.push(error.message);session?.fail(error);},checkActive(){},async emitRequest(raw){
  const frame=parseNativeCompletionFrame(raw);requests++;completionDeadlines.push(frame.deadlineMonotonicMs);
  if(requests===1&&delayMs){const before=nativeSharedClock(),lease=verifyNativeCompletionLifetime({cellDir,sequence:1});await new Promise<void>(resolve=>originalTimer(resolve,delayMs));const after=nativeSharedClock(),remainingMs=nativeRemainingLifetime(lease,after);clockObservations.push({before,after,lease,remainingMs});assert.ok(after.wallMs-before.wallUpperMs>=60000);assert.ok(remainingMs>0&&remainingMs<240000);}
  const message=requests===1?{role:'assistant',content:null,tool_calls:[{id:'budget_branch',type:'function',function:{name:'branch',arguments:JSON.stringify({code:'async () => 7'})}}]}:{role:'assistant',content:'Synthetic branch completed.'};
  const {request,...envelope}=frame,response=encodeNative({...envelope,version:'native-completion-response-v1',message});await captureThroughFixedHelpers({base,cellDir},frame.completionSequence,response);bridge.accept(response);await finalizeFixedHelperRelay({base,cellDir},frame.completionSequence);
 }});
 const beginAction=bridge.beginAction.bind(bridge);bridge.beginAction=(sequence,remaining)=>{actionTimeouts.push(remaining);beginAction(sequence,remaining);};
 const started=monotonicNow();
 try{
  session=await createNativeSession({arm,root,allowedWritePaths:[],venv,env:nativeCheckEnv({venv},base,runtime),onHostAttempt(){throw Error('unexpected host call');},native:{cellDir,binding,bridge},...(timeoutMs===undefined?{}:{timeoutMs})});
  const [result]=await session.dispatch({kind:'do',sequence:1,args:{instruction:'Return a constant from the branch. No file changes.',tools:['readFile']}},abort.signal);
  assert.equal(result!.isError,false,result!.text);await session.close();const evidence=session.verifyNativeEvidence(),elapsedMs=monotonicNow()-started;
  assert.equal(requests,2);assert.equal(evidence.completion.accepted.length,2);assert.equal(completionDeadlines[1],completionDeadlines[0]);assert.deepEqual(actionTimeouts,[timeoutMs??300000]);assert.deepEqual(transportTimeouts,[timeoutMs??300000,timeoutMs??300000]);assert.deepEqual(branchTimeouts,[Math.min(timeoutMs??300000,60000)]);assert.deepEqual(faults,[]);
  if(delayMs)assert.ok(elapsedMs>60000&&elapsedMs<LIMITS.actionMs);
  fs.writeFileSync(path.join(base,'observations.json'),JSON.stringify({scope:'actual same-boot scripted fixed children and linked SDK; no actor/provider or grading',arm,timeoutMs:timeoutMs??'default',delayMs,elapsedMs,actionTimeouts,transportTimeouts,branchTimeouts,completionDeadlines,clockObservations,requests,evidence},null,2)+'\n');
 }catch(error){fs.writeFileSync(path.join(base,'unexpected-error.txt'),String(error instanceof Error?error.stack:error));throw error;}
 finally{abort.abort();try{await session?.close();}finally{requestMock.mock.restore();timerMock.mock.restore();}}
}

for(const timeoutMs of [undefined,300000,90000,5000])test(`actual session separates completion/action and local branch timing (${timeoutMs??'default'})`,async t=>{await sessionControl(t,'orchestrate-off',timeoutMs);});
for(const arm of ['orchestrate-off','orchestrate-on'] as const)test(`actual no-model session and fixed helpers survive beyond 60 seconds (${arm})`,{timeout:120000},async t=>{await sessionControl(t,arm,undefined,61000);});
