import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {digest} from './protocol.mjs';
import {createNativeCompletionBridge,encodeNative,parseNativeCompletionFrame,nativeCompletionPaths,NATIVE_COMPLETION_LIMITS,NativeClockSamplingError} from './native-completion.mjs';
import {captureNativeCompletion,nativeCompletionCaptureDiagnostic,verifyCapturedNativeCompletion,NATIVE_COMPLETION_READY} from './native-completion-capture.mjs';
import {runNativeCompletionBootstrap,recordNativeCompletionBootstrapExit} from './native-completion-bootstrap.mjs';
import {completionTransportSourceBindings} from './native-completion-transport.mjs';

const ack=raw=>({bytes:raw.length,sha256:digest(raw)});
const SECRET='PRIVATE_RESPONSE_CAPABILITY_PATH_SENTINEL';
/** Synthetic local bridge only. Fixed clock inputs; all fixtures retained; no actors/providers. */
async function fixture(t){
 const read=fs.readFileSync;
 t.mock.method(Date,'now',()=>100000);
 t.mock.method(fs,'readFileSync',function(file,...args){
  if(file==='/proc/sys/kernel/random/boot_id')return '01234567-89ab-cdef-0123-456789abcdef';
  if(file==='/proc/uptime')return '1.00 0.00';
  return read.call(this,file,...args);
 });
 const cellDir=fs.mkdtempSync(path.join(process.env.NATIVE_TEST_EVIDENCE??'/tmp','capture-diagnostic-'));
 const bindings=completionTransportSourceBindings(),admission=encodeNative({testOnly:true,bindings});
 fs.writeFileSync(path.join(cellDir,'admission.json'),admission,{flag:'wx'});
 const binding={sourceSHA256:digest(bindings),admissionSHA256:digest(admission),cellId:'synthetic',arm:'orchestrate-off',limitsSHA256:digest(NATIVE_COMPLETION_LIMITS)};
 let notify;const emitted=new Promise(resolve=>{notify=resolve;});
 const bridge=createNativeCompletionBridge({cellDir,binding,issueCapability:async()=>'a'.repeat(64),emitRequest:async raw=>notify(raw),onFatal(){},checkActive(){}});
 bridge.open();bridge.beginAction(1,60000);
 const abort=new AbortController(),pending=bridge.client.complete({system:'synthetic',messages:[{role:'user',content:'public'}],tools:[],signal:abort.signal});
 const rejected=assert.rejects(pending);t.after(async()=>{abort.abort();await rejected;});
 const frame=parseNativeCompletionFrame(await emitted);delete frame.request;
 const raw=encodeNative({...frame,version:'native-completion-response-v1',message:{role:'assistant',content:SECRET}});
 let output;await runNativeCompletionBootstrap({cellDir,sequence:1,emit:async raw=>{output=raw;return ack(raw);}});
 recordNativeCompletionBootstrapExit({cellDir,sequence:1,output,exitCode:0,signal:null});
 return {cellDir,raw,p:nativeCompletionPaths(cellDir,1),bridge};
}

test('diagnostic vocabulary is bounded, cannot leak or invoke untrusted accessors',()=>{
 const hostile={get message(){assert.fail('message getter');},get code(){assert.fail('code getter');},toString(){assert.fail('coercion');}};
 const revoked=Proxy.revocable({},{});revoked.revoke();
 for(const error of [SECRET,Symbol(SECRET),null,undefined,hostile,revoked.proxy,new Error(SECRET.repeat(10000)),{message:SECRET,code:SECRET},Object.assign(new Error(SECRET),{code:'ENOENT',path:SECRET,cause:SECRET})]){
  const diagnostic=nativeCompletionCaptureDiagnostic(error,SECRET),text=JSON.stringify(diagnostic);
  assert.ok(text.length<256);assert.equal(text.includes(SECRET),false);assert.equal(diagnostic.stage,'preflight');assert.ok(Object.isFrozen(diagnostic));
 }
 for(const [error,category,reason] of [[new NativeClockSamplingError(1000,21),'clock','sampling-skew'],[new Error('native helper clock elapsed drift'),'clock','clock-elapsed-drift'],[new Error('native original completion deadline'),'deadline','original-deadline'],[new Error('native completion revoked/terminal'),'lifecycle','revoked-or-terminal']]){
  assert.equal(nativeCompletionCaptureDiagnostic(error).category,category);assert.equal(nativeCompletionCaptureDiagnostic(error).reason,reason);
 }
});

test('live proxy errors remain unknown without running any inspection trap',()=>{
 let traps=0;
 const error=new Proxy(new NativeClockSamplingError(1000,21),{
  getOwnPropertyDescriptor(){traps++;throw new Error(SECRET);},
  getPrototypeOf(){traps++;throw new Error(SECRET);},
  get(){traps++;throw new Error(SECRET);},
 });
 const diagnostic=nativeCompletionCaptureDiagnostic(error,'receipt-persist');
 assert.equal(traps,0);
 assert.deepEqual(diagnostic,{version:'native-completion-capture-diagnostic-v1',stage:'receipt-persist',category:'unknown',reason:'unclassified',code:null});
 assert.ok(Object.isFrozen(diagnostic));
 assert.ok(JSON.stringify(diagnostic).length<256);
});

test('ordinary error with proxy prototype does not traverse prototype traps',()=>{
 let traps=0;
 const prototype=new Proxy(NativeClockSamplingError.prototype,{
  getOwnPropertyDescriptor(){traps++;throw new Error(SECRET);},
  getPrototypeOf(){traps++;throw new Error(SECRET);},
  get(){traps++;throw new Error(SECRET);},
 });
 const error=Object.create(prototype);
 const diagnostic=nativeCompletionCaptureDiagnostic(error,'receipt-ack');
 assert.equal(traps,0);
 assert.deepEqual(diagnostic,{version:'native-completion-capture-diagnostic-v1',stage:'receipt-ack',category:'unknown',reason:'unclassified',code:null});
});

for(const mode of ['persistence','ack','clock','cancel','deadline','output','final-check','failure-write'])test('post-receipt synthetic failure: '+mode,async t=>{
 const f=await fixture(t),input=new PassThrough(),abort=new AbortController(),parts=[];
 let now=100,timerCallback,originalError;
 const clock={now:()=>now,setTimeout:callback=>{timerCallback=callback;return 1;},clearTimeout:()=>{}};
 const open=fs.openSync;
 if(mode==='persistence'||mode==='failure-write')t.mock.method(fs,'openSync',function(file,...args){
  if(file===f.p['capture-receipt']||(mode==='failure-write'&&file===f.p['capture-failure'])){originalError??=Object.assign(new Error(SECRET),{code:'ENOSPC',path:SECRET});throw originalError;}
  return open.call(this,file,...args);
 });
 if(mode==='final-check'){
  const sync=fs.fsyncSync;
  t.mock.method(fs,'fsyncSync',function(fd){sync.call(this,fd);if(fs.existsSync(f.p['capture-receipt']))now=NaN;});
 }
 let caught;
 await assert.rejects(captureNativeCompletion({cellDir:f.cellDir,sequence:1,input,clock,signal:abort.signal,onReady:async raw=>{parts.push(raw);input.write(f.raw);return ack(raw);},emit:async raw=>{
  parts.push(raw);
  if(mode==='clock')now=NaN;
  if(mode==='cancel')abort.abort();
  if(mode==='deadline')timerCallback();
  if(mode==='output')throw new Error(SECRET);
  return mode==='ack'?{bytes:0,sha256:SECRET}:ack(raw);
 }}),error=>{caught=error;return true;});
 assert.equal(parts.length,2);assert.ok(parts[0].equals(NATIVE_COMPLETION_READY));assert.ok(fs.readFileSync(f.p['capture-input']).equals(f.raw));
 const expected={persistence:['receipt-persist','filesystem'],ack:['receipt-ack','acknowledgement'],clock:['receipt-ack','clock'],cancel:['receipt-output','cancellation'],deadline:['receipt-output','deadline'],output:['receipt-output','output'],'final-check':['final-check','clock'],'failure-write':['receipt-persist','filesystem']}[mode];
 const diagnostic=nativeCompletionCaptureDiagnostic(caught);
 assert.deepEqual([diagnostic.stage,diagnostic.category],expected);
 if(originalError)assert.equal(caught,originalError);
 assert.equal(JSON.stringify(diagnostic).includes(SECRET),false);
 if(mode!=='failure-write'){
  const failure=JSON.parse(fs.readFileSync(f.p['capture-failure'],'utf8'));
  assert.equal(failure.status,'incomplete');assert.equal(failure.retainedBytes,f.raw.length);assert.equal(failure.receivedBytes,f.raw.length);assert.deepEqual(failure.diagnostic,diagnostic);
  assert.ok(fs.statSync(f.p['capture-failure']).size<512);
 }else assert.equal(fs.existsSync(f.p['capture-failure']),false);
 assert.equal(fs.existsSync(f.p['capture-receipt']),mode==='final-check');
 assert.equal(fs.existsSync(f.p['capture-exit']),false);assert.equal(fs.existsSync(f.p.response),false);
 assert.throws(()=>verifyCapturedNativeCompletion({cellDir:f.cellDir,sequence:1,raw:f.raw}));
});

test('successful synthetic capture keeps exact receipt and still requires exit evidence',async t=>{
 const f=await fixture(t),input=new PassThrough(),parts=[];
 const receipt=await captureNativeCompletion({cellDir:f.cellDir,sequence:1,input,clock:{now:()=>100,setTimeout:()=>1,clearTimeout(){}},onReady:async raw=>{parts.push(raw);input.write(f.raw);return ack(raw);},emit:async raw=>{parts.push(raw);return ack(raw);}});
 assert.ok(fs.readFileSync(f.p['capture-receipt']).equals(parts[1]));assert.deepEqual(JSON.parse(parts[1]),receipt);assert.equal(fs.existsSync(f.p['capture-failure']),false);assert.equal('diagnostic' in receipt,false);
 assert.throws(()=>verifyCapturedNativeCompletion({cellDir:f.cellDir,sequence:1,raw:f.raw}));
});

test('invalid CLI invocation emits bounded diagnostic, retains nonzero exit and no stdout',()=>{
 const result=spawnSync(process.execPath,[path.join(import.meta.dirname,'native-completion-capture.mjs')],{encoding:'utf8',timeout:3000,maxBuffer:1024});
 assert.equal(result.status,1);assert.equal(result.signal,null);assert.equal(result.stdout,'');assert.ok(result.stderr.length<512);
 const [line,warning]=result.stderr.trim().split('\n');assert.deepEqual(JSON.parse(line),nativeCompletionCaptureDiagnostic(new Error('unknown')));assert.match(warning,/do not relay or retry/);
});
