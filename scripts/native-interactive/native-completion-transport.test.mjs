import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {digest} from './protocol.mjs';
import {createNativeCompletionBridge,encodeNative,parseNativeCompletionFrame,nativeCompletionPaths,assertNativeCompletionActive,verifyNativeCompletionEvidence} from './native-completion.mjs';
import {createFixedTransportTestBinding} from './completion-helper-test-support.mjs';
import {generateNativeCompletionBootstrap} from './native-completion-bootstrap.mjs';
import {NATIVE_COMPLETION_READY} from './native-completion-capture.mjs';
import {bootstrapCompletionTransport,captureCompletionTransport,observeCompletionTransport,readCompletionTransport,verifyCompletionTransport,completionTransportPaths,composeCompletionTransport,completionTransportLaunch,strictTransportUTF8,TRANSPORT_READY,TRANSPORT_VERDICT,FIXED_COMPLETION_TRANSPORT_LIMITS} from './native-completion-transport.mjs';
import {completionTransportProgram,completionTransportRelayProgram} from './native-completion-transport-orchestration.mjs';

const ROOT=process.env.NATIVE_TEST_EVIDENCE??'/tmp';
const SUPERVISOR_SESSION=9001;
const REQUEST={system:'Public synthetic transport control only. No actor or provider.',messages:[{role:'user',content:'Literal € 漢字 " \\ $(false) `false`; newline\nand tab\t'}],tools:[]};
const ack=raw=>({bytes:raw.length,sha256:digest(raw)});
const terminal=raw=>({output:raw.toString('utf8'),wall_time_seconds:0,exit_code:0});
const live=(raw,session=101)=>({output:raw.toString('utf8'),wall_time_seconds:0,session_id:session});

/** A real bridge with public synthetic content. Every fixture and failed byte remains on disk. */
async function fixture(t,{requestMs=300000,wrongAdmittedPrefix=false}={}){
 const cellDir=fs.mkdtempSync(path.join(ROOT,'fixed-transport-'));
 let binding=createFixedTransportTestBinding({cellDir,arm:'orchestrate-off',cellId:'synthetic',limitsSHA256:'c'.repeat(64)});
 if(wrongAdmittedPrefix){
  const file=path.join(cellDir,'admission.json'),original=fs.readFileSync(file),admission=JSON.parse(original.toString('utf8'));
  const key=Object.keys(admission.bindings).find(key=>key.endsWith('native-completion-response-contract.txt'));assert.ok(key);
  const retained=cellDir+'-wrong-admitted-prefix';fs.mkdirSync(retained);fs.writeFileSync(path.join(retained,'admission-original.jsonl'),original);
  admission.bindings[key]='f'.repeat(64);const changed=Buffer.from(JSON.stringify(admission,null,2)+'\n');fs.writeFileSync(file,changed);fs.writeFileSync(path.join(retained,'admission-mutated.jsonl'),changed);
  binding={...binding,sourceSHA256:digest(admission.bindings),admissionSHA256:digest(changed)};
 }

 const abort=new AbortController();let resolveEmitted,rejectEmitted;
 const emitted=new Promise((resolve,reject)=>{resolveEmitted=resolve;rejectEmitted=reject;});emitted.catch(()=>{});
 const faults=[];
 const bridge=createNativeCompletionBridge({cellDir,binding,limits:{requestMs},issueCapability:async()=>randomBytes(32).toString('hex'),emitRequest:raw=>resolveEmitted(raw),checkActive(){},onFatal:error=>{faults.push(error.message);rejectEmitted(error);}});
 bridge.open();bridge.beginAction(1,300000);
 const outcome=bridge.client.complete({...REQUEST,signal:abort.signal}).then(value=>({ok:true,value}),error=>({ok:false,error}));
 const requestRaw=await emitted,request=parseNativeCompletionFrame(requestRaw);
 const {request:_payload,...bound}=request;
 const response=encodeNative({...bound,version:'native-completion-response-v1',message:{role:'assistant',content:`literal € 漢字 $(touch ${cellDir}/must-not-exist) \`false\`; " \\ \n`}});
 const f={cellDir,binding,abort,bridge,outcome,faults,requestRaw,request,response,sequence:1};
 fs.writeFileSync(path.join(cellDir,'CONTROL-SCOPE.txt'),'Public no-model control. Original bootstrap/capture subprocess close observations are real. Objects representing native exec/write results are synthetic test data, not actual native tool observations. No token, billing, isolation, model consumption or complete log claim. Fixtures are retained.\n');
 t.after(async()=>{abort.abort();await outcome;});
 return f;
}
/** Observer input is delayed until READY acknowledgement, just as the fixed native flow requires. */
async function observe(f,stage,payload,{inputMode='normal',signal,transform}={}){
 const input=new PassThrough(),outputs=[];
 const data=encodeNative(transform?transform({...payload,observerInitial:live(TRANSPORT_READY)}):{...payload,observerInitial:live(TRANSPORT_READY)});
 const result=observeCompletionTransport({cellDir:f.cellDir,sequence:1,stage,input,signal,emit:async raw=>{
  outputs.push(Buffer.from(raw));
  if(raw.equals(TRANSPORT_READY)){
   if(inputMode==='early')input.write(data);
   else if(inputMode==='cancel')setImmediate(()=>f.abort.abort());
   else if(inputMode==='hang'){} // Caller supplies a separate cancellation signal.
   else setImmediate(()=>input.write(data));
  }else if(raw.equals(TRANSPORT_VERDICT)&&inputMode==='late-extra')input.write(Buffer.from('extra'));
  return ack(raw);
 }});
 try{return {value:await result,outputs,input};}finally{
  assert.equal(input.listenerCount('data'),0,'observer data listener must detach on every outcome');
  assert.equal(input.listenerCount('end'),0,'observer EOF listener must detach on every outcome');
  assert.equal(input.listenerCount('error'),0,'observer error listener must detach on every outcome');
 }
}
/** Production wrapper runs the actual original bootstrap CLI and records its drained close. */
async function bootstrap(f){
 const chunks=[];
 await bootstrapCompletionTransport({cellDir:f.cellDir,sequence:1,emit:async raw=>{chunks.push(Buffer.from(raw));return ack(raw);}});
 f.bootstrapOutput=Buffer.concat(chunks);
 assert.deepEqual(f.bootstrapOutput,composeCompletionTransport({cellDir:f.cellDir,sequence:1}));
 return f.bootstrapOutput;
}
async function bootstrapObserved(f){await bootstrap(f);await observe(f,'bootstrap-observe',{result:terminal(f.bootstrapOutput)});}
/** Production wrapper runs the actual original capture CLI; its input remains literal stream data. */
async function capture(f){
 const input=new PassThrough(),chunks=[];
 await captureCompletionTransport({cellDir:f.cellDir,sequence:1,input,emit:async raw=>{
  chunks.push(Buffer.from(raw));
  if(raw.equals(NATIVE_COMPLETION_READY))setImmediate(()=>{
   const euro=f.response.indexOf(Buffer.from('€'));
   if(euro>=0){input.write(f.response.subarray(0,euro+1));input.write(f.response.subarray(euro+1));}
   else input.write(f.response);
  });
  return ack(raw);
 }});
 assert.equal(input.listenerCount('data'),0);
 f.captureOutput=Buffer.concat(chunks);
 assert.deepEqual(f.captureOutput.subarray(0,NATIVE_COMPLETION_READY.length),NATIVE_COMPLETION_READY);
 f.capturePayload={initial:live(NATIVE_COMPLETION_READY,202),final:terminal(f.captureOutput.subarray(NATIVE_COMPLETION_READY.length)),response:f.response.toString('utf8')};
 return f.capturePayload;
}
async function captureObserved(f){await bootstrapObserved(f);await capture(f);await observe(f,'capture-observe',f.capturePayload);}
async function readerObserved(f){
 await captureObserved(f);const chunks=[];
 await readCompletionTransport({cellDir:f.cellDir,sequence:1,emit:async raw=>{chunks.push(Buffer.from(raw));return ack(raw);}});
 f.readerOutput=Buffer.concat(chunks);assert.deepEqual(f.readerOutput,f.response);
 await observe(f,'reader-observe',{result:terminal(f.readerOutput),supervisorSessionId:SUPERVISOR_SESSION});
}
async function accepted(f){
 await readerObserved(f);
 verifyCompletionTransport({cellDir:f.cellDir,sequence:1,through:'reader-observe',raw:f.response});
 f.bridge.accept(f.response);assert.equal((await f.outcome).ok,true);
 await observe(f,'relay-outcome',{result:live(Buffer.from('synthetic acknowledged supervisor feedback\n'),SUPERVISOR_SESSION)});
 f.bridge.endAction();
 return verifyCompletionTransport({cellDir:f.cellDir,sequence:1});
}
/** Preserve the prior artifact next to the fixture before an intentional synthetic corruption. */
function mutate(f,file,label,change){
 const retained=f.cellDir+'-mutation-'+label;fs.mkdirSync(retained);
 const original=fs.readFileSync(file);fs.writeFileSync(path.join(retained,'original.raw'),original);
 const altered=change(original);fs.writeFileSync(file,altered);fs.writeFileSync(path.join(retained,'altered.raw'),altered);
 fs.writeFileSync(path.join(retained,'mutation.json'),JSON.stringify({file,label,originalSHA256:digest(original),alteredSHA256:digest(altered)})+'\n');
}

test('fixed transport: real inner helpers, exact hostile bytes, complete synthetic outer flow and historical terminal verification',async t=>{
 const f=await fixture(t);assert.ok(fs.readFileSync(path.join(f.cellDir,'admission.json'),'utf8').includes('\n  '),'positive admission uses real coordinator pretty JSON format');const ev=await accepted(f);
 assert.ok(ev.files.length>=20);assert.match(ev.scope,/procedural/);
 assert.equal(fs.existsSync(path.join(f.cellDir,'must-not-exist')),false,'literal shell-looking response must not execute');
 assert.deepEqual(fs.readFileSync(nativeCompletionPaths(f.cellDir,1)['capture-input']),f.response);
 const bootstrap=JSON.parse(fs.readFileSync(completionTransportPaths(f.cellDir,1)['bootstrap-child'],'utf8'));
 const capture=JSON.parse(fs.readFileSync(completionTransportPaths(f.cellDir,1)['capture-child'],'utf8'));
 for(const child of [bootstrap,capture]){assert.equal(child.closed,true);assert.equal(child.exitCode,0);assert.equal(child.signal,null);assert.equal(child.cleanupUncertain,false);}
 assert.throws(()=>assertNativeCompletionActive({cellDir:f.cellDir,sequence:1}),/revoked|terminal/);
 // A historical verifier must not consult active clocks, even after terminal state.
 const originalRead=fs.readFileSync;fs.readFileSync=function(file,...rest){if(String(file)==='/proc/uptime'||String(file)==='/proc/sys/kernel/random/boot_id')throw Error('historical verifier consulted active clock');return originalRead.call(this,file,...rest);};
 try{assert.deepEqual(verifyCompletionTransport({cellDir:f.cellDir,sequence:1}),ev);assert.ok(verifyNativeCompletionEvidence({cellDir:f.cellDir,binding:f.binding}).accepted.length===1);}finally{fs.readFileSync=originalRead;}
 f.bridge.close();
});

test('fixed transport: launch is self-contained, request is contiguous, and UTF-8 boundaries are exact',async t=>{
 const f=await fixture(t);const composed=composeCompletionTransport({cellDir:f.cellDir,sequence:1}),launch=completionTransportLaunch({cellDir:f.cellDir,sequence:1});
 assert.ok(composed.includes(f.requestRaw));assert.equal(composed.at(-1),10);
 assert.ok(composed.length+launch.length<=98304);
 assert.match(launch.toString('utf8'),/BOOTSTRAP_PROGRAM_BEGIN/);assert.match(launch.toString('utf8'),/CAPTURE_PROGRAM_BEGIN/);assert.match(launch.toString('utf8'),/RESPONSE_DATA_VALUE/);
 assert.equal(strictTransportUTF8('a'.repeat(98304)).length,98304);
 assert.throws(()=>strictTransportUTF8('a'.repeat(98305)),/limit/);
 assert.throws(()=>strictTransportUTF8('\ud800'),/UTF-8/);
 assert.deepEqual(strictTransportUTF8('€漢字\n'),Buffer.from('€漢字\n'));
});

test('fixed transport: exact composed inbound frame boundary is accepted and one byte over is rejected',async t=>{
 const f=await fixture(t),dir=fs.mkdtempSync(path.join(ROOT,'fixed-compose-boundary-'));
 const launch=completionTransportLaunch({cellDir:dir,sequence:1}),prefix=fs.readFileSync(path.join(import.meta.dirname,'native-completion-response-contract.txt'));
 const make=n=>{const request=structuredClone(f.request);request.request.system='x'.repeat(n);request.requestSHA256=digest(encodeNative(request.request));return encodeNative(request);};
 let fill=0,raw=make(0);for(let n=0;n<8;n++){const total=launch.length+prefix.length+generateNativeCompletionBootstrap(raw).length;if(total===98304)break;fill+=98304-total;assert.ok(fill>=0);raw=make(fill);}
 assert.equal(launch.length+prefix.length+generateNativeCompletionBootstrap(raw).length,98304);
 const requestFile=nativeCompletionPaths(dir,1).request;fs.writeFileSync(requestFile,raw);fs.writeFileSync(path.join(dir,'exact-request-retained.jsonl'),raw);
 assert.equal(composeCompletionTransport({cellDir:dir,sequence:1}).length+launch.length,98304);
 const larger=make(fill+1);fs.writeFileSync(requestFile,larger);fs.writeFileSync(path.join(dir,'over-request-retained.jsonl'),larger);
 assert.throws(()=>composeCompletionTransport({cellDir:dir,sequence:1}),/composed frame limit/);
 fs.writeFileSync(path.join(dir,'CONTROL-SCOPE.txt'),'Synthetic composition-only boundary. No active lease or accepted solve is represented. Exact and one-byte-over source frames retained.\n');
});

for(const over of [0,1])test(`fixed transport: conservative helper output aggregate boundary ${over?'plus one rejected':'exact accepted'}`,async t=>{
 const f=await fixture(t),initial=composeCompletionTransport({cellDir:f.cellDir,sequence:1}).length+completionTransportLaunch({cellDir:f.cellDir,sequence:1}).length;
 let remaining=FIXED_COMPLETION_TRANSPORT_LIMITS.totalOutputBytes-initial,last;
 for(let sequence=2;remaining>0;sequence++){
  assert.ok(sequence<=32);const launchBytes=completionTransportLaunch({cellDir:f.cellDir,sequence}).length;
  assert.ok(remaining>=launchBytes);let bytes=Math.min(98304,remaining-launchBytes);
  const nextLaunch=sequence<32?completionTransportLaunch({cellDir:f.cellDir,sequence:sequence+1}).length:0;
  if(remaining-launchBytes-bytes>0&&remaining-launchBytes-bytes<nextLaunch)bytes-=nextLaunch-(remaining-launchBytes-bytes);
  assert.ok(bytes>=0);const padding=completionTransportPaths(f.cellDir,sequence);fs.writeFileSync(padding['bootstrap-attempt'],Buffer.from('{}\n'));last=padding['bootstrap-output'];fs.writeFileSync(last,Buffer.alloc(bytes,65));remaining-=launchBytes+bytes;
 }
 assert.equal(remaining,0);if(over){const current=fs.readFileSync(last);assert.ok(current.length<98304);fs.writeFileSync(last,Buffer.concat([current,Buffer.from('A')]));}
 fs.writeFileSync(path.join(f.cellDir,'AGGREGATE-SYNTHETIC-PADDING.txt'),'Later-sequence attempt/output files are synthetic byte-count padding only, not valid requests, completed helpers or accepted evidence.\n');
 if(over){await assert.rejects(bootstrap(f),/aggregate/);assert.ok(fs.existsSync(completionTransportPaths(f.cellDir,1).failure));}
 else await bootstrap(f);
});

for(const variant of ['missing-LF','prefix-missing-LF','truncation-keeps-final-marker','nonterminal','nonzero','extra-result-field','changed-ready'])test('fixed transport: actual-result gate rejects '+variant,async t=>{
 const f=await fixture(t);await bootstrap(f);
 const result=terminal(f.bootstrapOutput);let observerInitial=live(TRANSPORT_READY);
 if(variant==='missing-LF')result.output=result.output.slice(0,-1);
 if(variant==='prefix-missing-LF'){const i=result.output.indexOf('NATIVE_COMPLETION_BEGIN');assert.ok(i>0);result.output=result.output.slice(0,i-1)+result.output.slice(i);}
 if(variant==='truncation-keeps-final-marker'){const marker=result.output.lastIndexOf('NATIVE_COMPLETION_END');assert.ok(marker>0);result.output=result.output.slice(0,64)+'[truncated]\n'+result.output.slice(marker);}
 if(variant==='nonterminal'){delete result.exit_code;result.session_id=777;}
 if(variant==='nonzero')result.exit_code=1;
 if(variant==='extra-result-field')result.signal=null;
 if(variant==='changed-ready')observerInitial={...observerInitial,output:observerInitial.output.replace('\n','\r\n')};
 await assert.rejects(observe(f,'bootstrap-observe',{result},{transform:value=>({...value,observerInitial})}));
 assert.ok(fs.existsSync(completionTransportPaths(f.cellDir,1).failure));
 assert.throws(()=>verifyCompletionTransport({cellDir:f.cellDir,sequence:1,through:'bootstrap-observe'}),/failed/);
});

test('fixed transport: valid-but-altered original response data cannot pass capture observation',async t=>{
 const f=await fixture(t);await bootstrapObserved(f);await capture(f);
 const changed=parseNativeCompletionFrame(f.response);changed.message.content='valid but different original data';
 await assert.rejects(observe(f,'capture-observe',{...f.capturePayload,response:encodeNative(changed).toString('utf8')}),/original response data changed/);
 assert.deepEqual(fs.readFileSync(nativeCompletionPaths(f.cellDir,1)['capture-input']),f.response);
 assert.ok(fs.existsSync(completionTransportPaths(f.cellDir,1).failure));
});

test('fixed transport: helper-only success cannot reach worker before capture observation and reader intent',async t=>{
 const f=await fixture(t);await bootstrapObserved(f);await capture(f);
 assert.throws(()=>f.bridge.accept(f.response));
 assert.equal((await f.outcome).ok,false);
 assert.equal(fs.existsSync(completionTransportPaths(f.cellDir,1)['relay-intent']),false);
});

for(const mode of ['early','late-extra'])test('fixed transport: observer rejects '+mode+' data and detaches listeners',async t=>{
 const f=await fixture(t);await bootstrap(f);
 await assert.rejects(observe(f,'bootstrap-observe',{result:terminal(f.bootstrapOutput)},{inputMode:mode}),/before READY|extra observation/);
 assert.ok(fs.existsSync(completionTransportPaths(f.cellDir,1).failure));
});

test('fixed transport: cancelled waiting observer detaches all input listeners and stays failed',async t=>{
 const f=await fixture(t);await bootstrap(f);const localAbort=new AbortController(),input=new PassThrough();
 const pending=observeCompletionTransport({cellDir:f.cellDir,sequence:1,stage:'bootstrap-observe',input,signal:localAbort.signal,emit:async raw=>{if(raw.equals(TRANSPORT_READY))setImmediate(()=>localAbort.abort());return ack(raw);}});
 await assert.rejects(pending,/cancelled/);
 for(const event of ['data','end','error'])assert.equal(input.listenerCount(event),0);
 assert.ok(fs.existsSync(completionTransportPaths(f.cellDir,1).failure));
 await assert.rejects(bootstrapCompletionTransport({cellDir:f.cellDir,sequence:1,emit:async raw=>ack(raw)}),/failed|revoked/);
});

test('fixed transport: capture rejects original response bytes before READY acknowledgement',async t=>{
 const f=await fixture(t);await bootstrapObserved(f);const input=new PassThrough();
 await assert.rejects(captureCompletionTransport({cellDir:f.cellDir,sequence:1,input,emit:async raw=>{if(raw.equals(NATIVE_COMPLETION_READY))input.write(f.response);return ack(raw);}}),/before READY/);
 assert.ok(fs.existsSync(completionTransportPaths(f.cellDir,1).failure));
 assert.equal(input.listenerCount('data'),0);
});

test('fixed transport: repeated bootstrap consumes no second original helper and poisons later admission',async t=>{
 const f=await fixture(t);await bootstrapObserved(f);const p=completionTransportPaths(f.cellDir,1),original=fs.readFileSync(p['bootstrap-child']);
 await assert.rejects(bootstrapCompletionTransport({cellDir:f.cellDir,sequence:1,emit:async raw=>ack(raw)}),/EEXIST|exists/);
 assert.deepEqual(fs.readFileSync(p['bootstrap-child']),original);assert.ok(fs.existsSync(p.failure));
 assert.throws(()=>verifyCompletionTransport({cellDir:f.cellDir,sequence:1,through:'bootstrap-observe'}),/failed/);
});

test('fixed transport: cancellation after child close but during bootstrap emission cannot become success',async t=>{
 const f=await fixture(t),localAbort=new AbortController();
 await assert.rejects(bootstrapCompletionTransport({cellDir:f.cellDir,sequence:1,signal:localAbort.signal,emit:async raw=>{localAbort.abort();return ack(raw);}}),/cancelled/);
 const p=completionTransportPaths(f.cellDir,1);assert.ok(fs.existsSync(p['bootstrap-child']));assert.ok(fs.existsSync(p.failure));assert.equal(fs.existsSync(p['bootstrap-receipt']),false);
});

for(const target of ['bootstrap-attempt','bootstrap-receipt','capture-child','reader-receipt','relay-intent'])test('fixed transport: retrospective reconstruction rejects mutated '+target,async t=>{
 const f=await fixture(t);await accepted(f);const file=completionTransportPaths(f.cellDir,1)[target];
 mutate(f,file,target,raw=>{const value=parseNativeCompletionFrame(raw);if(target==='bootstrap-attempt')value.extra='not allowed';else if(target==='bootstrap-receipt')value.outputBytes++;else if(target==='capture-child')value.signal='SIGKILL';else if(target==='reader-receipt')value.outputSHA256='f'.repeat(64);else value.supervisorSessionId++;return encodeNative(value);});
 assert.throws(()=>verifyCompletionTransport({cellDir:f.cellDir,sequence:1}));
});

test('fixed transport: missing observation retained elsewhere blocks historical eligibility',async t=>{
 const f=await fixture(t);await accepted(f);const file=completionTransportPaths(f.cellDir,1)['capture-observation'],retained=f.cellDir+'-missing-observation';fs.mkdirSync(retained);fs.renameSync(file,path.join(retained,'capture-observation-original.jsonl'));
 assert.throws(()=>verifyCompletionTransport({cellDir:f.cellDir,sequence:1}));
 assert.ok(fs.existsSync(path.join(retained,'capture-observation-original.jsonl')));
});

test('fixed transport: accepted response without final relay outcome is not complete evidence',async t=>{
 const f=await fixture(t);await readerObserved(f);f.bridge.accept(f.response);assert.equal((await f.outcome).ok,true);
 assert.throws(()=>verifyCompletionTransport({cellDir:f.cellDir,sequence:1}));
 assert.throws(()=>verifyNativeCompletionEvidence({cellDir:f.cellDir,binding:f.binding}));
 assert.equal(fs.existsSync(completionTransportPaths(f.cellDir,1)['relay-outcome-receipt']),false);
});

test('fixed transport: wrong supervisor session outcome remains failure after accepted response',async t=>{
 const f=await fixture(t);await readerObserved(f);f.bridge.accept(f.response);assert.equal((await f.outcome).ok,true);
 await assert.rejects(observe(f,'relay-outcome',{result:live(Buffer.from('synthetic feedback\n'),SUPERVISOR_SESSION+1)}),/supervisor write outcome/);
 assert.ok(fs.existsSync(completionTransportPaths(f.cellDir,1).failure));assert.throws(()=>verifyCompletionTransport({cellDir:f.cellDir,sequence:1}),/failed/);
});

/** Pure orchestration test double. This does not start an executable or emulate native authentication. */
function toolDouble({bootstrap='public bootstrap\n',response='synthetic response\n',relayThrows=false}={}){
 const calls=[],state=new Map(),visible=[],sessions=new Map();let id=100;
 const tools={
  async exec_command(args){calls.push({tool:'exec_command',args:structuredClone(args)});const mode=args.cmd.split(' ').at(-3);
   if(mode==='fail')return terminal(Buffer.alloc(0));
   if(mode==='bootstrap')return terminal(Buffer.from(bootstrap));
   if(mode==='reader')return terminal(Buffer.from(response));
   if(mode==='capture'){const session=++id;sessions.set(session,'capture');return live(NATIVE_COMPLETION_READY,session);}
   if(mode.endsWith('-observe')||mode==='relay-outcome'){const session=++id;sessions.set(session,mode);return live(TRANSPORT_READY,session);}
   throw Error('unexpected fixed command');
  },
  async write_stdin(args){calls.push({tool:'write_stdin',args:structuredClone(args)});
   if(args.session_id===SUPERVISOR_SESSION){if(relayThrows)throw Error('synthetic uncertain native write');return live(Buffer.from('synthetic feedback\n'),SUPERVISOR_SESSION);}
   const mode=sessions.get(args.session_id);assert.ok(mode,'write target must come from stored initial result');
   if(mode==='capture'){assert.equal(args.chars,response);return terminal(Buffer.from('synthetic capture receipt\n'));}
   const payload=JSON.parse(args.chars);assert.equal(payload.observerInitial.session_id,args.session_id);
   if(mode==='bootstrap-observe')assert.equal(payload.result.output,bootstrap);
   if(mode==='capture-observe'){assert.equal(payload.response,response);assert.equal(payload.initial.output,NATIVE_COMPLETION_READY.toString('utf8'));}
   if(mode==='reader-observe'){assert.equal(payload.result.output,response);assert.equal(payload.supervisorSessionId,SUPERVISOR_SESSION);}
   return terminal(TRANSPORT_VERDICT);
  },
 };
 return {tools,calls,state,visible,store:(k,v)=>state.set(k,v),load:k=>state.get(k),text:v=>visible.push(v)};
}
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
/** Execute only source-generated trusted orchestration with inert tool doubles; response is a JSON literal. */
async function runProgram(code,harness){const fn=new AsyncFunction('tools','store','load','text',code);await fn(harness.tools,harness.store,harness.load,harness.text);}

test('fixed transport: generated actor/parent programs preserve data and use independent local state',async t=>{
 const f=await fixture(t),response=f.response.toString('utf8'),actor=toolDouble({bootstrap:f.requestRaw.toString('utf8'),response});
 await runProgram(completionTransportProgram({cellDir:f.cellDir,sequence:1,phase:'bootstrap'}),actor);
 assert.equal(actor.visible.at(-1),f.requestRaw.toString('utf8'));
 await runProgram(completionTransportProgram({cellDir:f.cellDir,sequence:1,phase:'capture'}).replace('RESPONSE_DATA_VALUE',JSON.stringify(response)),actor);
 assert.equal(actor.calls.length,7,'nominal actor-side native subcalls');
 for(const call of actor.calls.filter(c=>c.tool==='exec_command'))assert.equal(call.args.cmd.includes(response),false);
 const parent=toolDouble({response});assert.equal(parent.state.size,0,'no inherited actor local store');
 await runProgram(completionTransportProgram({cellDir:f.cellDir,sequence:1,phase:'reader',supervisorSessionId:SUPERVISOR_SESSION}),parent);
 const relay=completionTransportRelayProgram({cellDir:f.cellDir,sequence:1,supervisorSessionId:SUPERVISOR_SESSION});
 await runProgram(relay,parent);
 assert.equal(parent.calls.filter(c=>c.tool==='write_stdin'&&c.args.session_id===SUPERVISOR_SESSION).length,1);
 await assert.rejects(runProgram(relay,parent),/already attempted|failed/);
 assert.equal(parent.calls.filter(c=>c.tool==='write_stdin'&&c.args.session_id===SUPERVISOR_SESSION).length,1);
});

test('fixed transport: uncertain supervisor write is recorded failed and never resent',async t=>{
 const f=await fixture(t),parent=toolDouble({response:f.response.toString('utf8'),relayThrows:true});
 await runProgram(completionTransportProgram({cellDir:f.cellDir,sequence:1,phase:'reader',supervisorSessionId:SUPERVISOR_SESSION}),parent);
 const relay=completionTransportRelayProgram({cellDir:f.cellDir,sequence:1,supervisorSessionId:SUPERVISOR_SESSION});
 await assert.rejects(runProgram(relay,parent),/uncertain native write/);
 await assert.rejects(runProgram(relay,parent),/failed|already attempted/);
 assert.equal(parent.calls.filter(c=>c.tool==='write_stdin'&&c.args.session_id===SUPERVISOR_SESSION).length,1);
 assert.equal(parent.calls.filter(c=>c.tool==='exec_command'&&c.args.cmd.includes(' fail ')).length,1);
});

test('fixed transport: successive cell/sequence relay programs share a harness without stale state or replay',async t=>{
 const f=await fixture(t),other=fs.mkdtempSync(path.join(ROOT,'fixed-transport-second-cell-'));
 const parent=toolDouble({response:f.response.toString('utf8')});
 const assignments=[{cellDir:f.cellDir,sequence:1},{cellDir:f.cellDir,sequence:2},{cellDir:other,sequence:1}];
 for(const assignment of assignments){
  await runProgram(completionTransportProgram({...assignment,phase:'reader',supervisorSessionId:SUPERVISOR_SESSION}),parent);
  const relay=completionTransportRelayProgram({...assignment,supervisorSessionId:SUPERVISOR_SESSION});
  await runProgram(relay,parent);
  await assert.rejects(runProgram(relay,parent),/already attempted|failed/);
 }
 assert.equal(parent.calls.filter(c=>c.tool==='write_stdin'&&c.args.session_id===SUPERVISOR_SESSION).length,assignments.length);
});

test('fixed transport: expired original request permits no bootstrap child or prompt bytes',async t=>{
 const f=await fixture(t,{requestMs:1000});const outcome=await f.outcome;
 assert.equal(outcome.ok,false);assert.match(outcome.error.message,/deadline/);
 let emitted=0;
 await assert.rejects(bootstrapCompletionTransport({cellDir:f.cellDir,sequence:1,emit:async raw=>{emitted+=raw.length;return ack(raw);}}),/deadline|revoked|terminal/);
 assert.equal(emitted,0);assert.equal(fs.existsSync(completionTransportPaths(f.cellDir,1)['bootstrap-child']),false);
 assert.ok(fs.existsSync(completionTransportPaths(f.cellDir,1).failure));
});

test('fixed transport: parent reader target A cannot be relayed to target B',async t=>{
 const f=await fixture(t),parent=toolDouble({response:f.response.toString('utf8')});
 await runProgram(completionTransportProgram({cellDir:f.cellDir,sequence:1,phase:'reader',supervisorSessionId:SUPERVISOR_SESSION}),parent);
 const writesBefore=parent.calls.filter(c=>c.tool==='write_stdin').length;
 const changedTarget=completionTransportRelayProgram({cellDir:f.cellDir,sequence:1,supervisorSessionId:SUPERVISOR_SESSION+1});
 await assert.rejects(runProgram(changedTarget,parent),/target|session|mismatch/i);
 assert.equal(parent.calls.filter(c=>c.tool==='write_stdin').length,writesBefore,'target mismatch must reject before any supervisor write');
});

test('fixed transport: changed frozen admission fails before child spawn or prompt exposure',async t=>{
 const f=await fixture(t);
 mutate(f,path.join(f.cellDir,'admission.json'),'changed-admission',raw=>{const admission=JSON.parse(raw.toString('utf8'));admission.syntheticTamper=true;return Buffer.from(JSON.stringify(admission,null,2)+'\n');});
 let emitted=0;
 await assert.rejects(bootstrapCompletionTransport({cellDir:f.cellDir,sequence:1,emit:async raw=>{emitted+=raw.length;return ack(raw);}}),/admission|source|binding/i);
 assert.equal(emitted,0);assert.equal(fs.existsSync(completionTransportPaths(f.cellDir,1)['bootstrap-child']),false);
 assert.ok(fs.existsSync(completionTransportPaths(f.cellDir,1).failure));
});

test('fixed transport: consistently bound but wrong admitted prefix hash fails before child spawn or exposure',async t=>{
 const f=await fixture(t,{wrongAdmittedPrefix:true});let emitted=0;
 await assert.rejects(bootstrapCompletionTransport({cellDir:f.cellDir,sequence:1,emit:async raw=>{emitted+=raw.length;return ack(raw);}}),/source|prefix|admission|binding/i);
 assert.equal(emitted,0);assert.equal(fs.existsSync(completionTransportPaths(f.cellDir,1)['bootstrap-child']),false);
 assert.ok(fs.existsSync(completionTransportPaths(f.cellDir,1).failure));
});
