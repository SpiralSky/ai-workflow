import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createSupervisorCompletionLane,createCompletionFramer,createCompletionIPCFramer,encodeFinalSubmissionFrame,COMPLETION_TRANSPORT_LIMITS} from './completion-lane.mjs';
import {runCell} from './controller.mjs';
import {parseAction,digest,LIMITS} from './protocol.mjs';
const binding={sourceSHA256:'a'.repeat(64),admissionSHA256:'b'.repeat(64),cellId:'synthetic-cell',arm:'orchestrate-off',limitsSHA256:'c'.repeat(64)};
const encode=value=>Buffer.from(JSON.stringify(value)+'\n');
const payload={system:'public',messages:[],tools:[]};
const reserve={version:'native-completion-reserve-v1',binding,actionSequence:1,completionSequence:1,completionId:'synthetic-id',requestSHA256:digest(encode(payload)),deadlineMonotonicMs:LIMITS.actionMs};
function setup(overrides={}){let at=0;const worker=[],external=[],faults=[];const lane=createSupervisorCompletionLane({cellDir:'/unused',binding,checkActive(){},emitWorker:async raw=>worker.push(JSON.parse(raw)),emitExternal:async raw=>external.push(JSON.parse(raw)),onFatal:e=>faults.push(e),now:()=>at,verifyCapture(){},verifyCompletion:()=>({summary:{accepted:true}}),verifyEvents:()=>({summary:{events:true}}),...overrides});return {lane,worker,external,faults,advance:n=>at+=n};}
async function request(s){s.lane.beginAction({kind:'do',sequence:1});await s.lane.worker(encode(reserve));const req={...reserve,version:'native-completion-request-v1',capability:s.worker[0].capability,request:payload};await s.lane.worker(encode(req));return {...reserve,version:'native-completion-response-v1',capability:req.capability,message:{role:'assistant',content:'done'}};}
test('planner allows only actual do/resolve schemas and terminal submit',()=>{
 for(const arm of ['orchestrate-off','orchestrate-on']){
  for(const a of [{kind:'do',sequence:1,args:{instruction:'read'}},{kind:'resolve',sequence:1,args:{ref:'@s1.c1',lines:[1,2]}},{kind:'submit',sequence:1}])assert.deepEqual(parseAction(JSON.stringify(a),arm,1),a);
  for(const a of [{kind:'tools',sequence:1,calls:[]},{kind:'branch',sequence:1,code:'report(1)'},{kind:'do',sequence:1,args:{instruction:'x',code:'bad'}},{kind:'resolve',sequence:1,args:{ref:'x',lines:[1]}},{kind:'resolve',sequence:1,args:{ref:{ref:'x',version:'v',path:'/tmp'}}}])assert.throws(()=>parseAction(JSON.stringify(a),arm,1));
 }
});
test('separate response leaves action pending and requires clean submit agreement',async()=>{
 const s=setup(),response=await request(s);assert.equal(s.external.length,1);assert.match(s.worker[0].capability,/^[a-f0-9]{64}$/);await s.lane.response(encode(response));
 assert.equal(s.lane.snapshot.pending,null);s.lane.endAction();s.lane.beginAction({kind:'submit',sequence:2});await s.lane.worker(encode({version:'native-completion-close-v1',binding,completion:{accepted:true},event:{events:true}}));s.lane.endAction();assert.deepEqual(s.lane.assertComplete(),{completion:{accepted:true},event:{events:true}});
});
test('completion cannot acknowledge action or admit a second planner action',async()=>{
 const s=setup();await request(s);assert.throws(()=>s.lane.endAction(),/before completion response/);assert.throws(()=>s.lane.beginAction({kind:'submit',sequence:2}),/before completion response/);assert.throws(()=>s.lane.assertComplete());assert.equal(s.lane.snapshot.failed,true);
});
test('original action deadline is not restarted by request or response',async()=>{
 const s=setup(),response=await request(s);s.advance(LIMITS.actionMs);await assert.rejects(s.lane.response(encode(response)),/original action deadline/);assert.throws(()=>s.lane.assertComplete(),/original action deadline/);
});
test('wrong capability is sticky, keeps pending identity, and denies submit',async()=>{
 const s=setup(),response=await request(s);response.capability='0'.repeat(64);await assert.rejects(s.lane.response(encode(response)));const first=s.lane.snapshot.fatalReason;assert.equal(s.lane.snapshot.pending,reserve.completionId);assert.throws(()=>s.lane.beginAction({kind:'submit',sequence:2}));assert.equal(s.lane.snapshot.fatalReason,first);
});
test('missing receipt fails before worker response forwarding',async()=>{
 const s=setup({verifyCapture(){throw Error('capture missing');}}),response=await request(s);await assert.rejects(s.lane.response(encode(response)),/capture missing/);assert.equal(s.worker.length,1);
});
test('failed fatal notice or close delivery never yields terminal agreement',async()=>{
 const s=setup({emitWorker:async()=>{throw Error('IPC write failed');}});s.lane.beginAction({kind:'do',sequence:1});await assert.rejects(s.lane.worker(encode(reserve)),/IPC write/);assert.throws(()=>s.lane.assertComplete(),/IPC write/);assert.equal(s.lane.snapshot.closed,false);
});
test('framer preserves split multibyte and rejects extra frames, partial EOF and duplicate keys',()=>{
 const raw=encode({text:'$(touch /tmp/NEVER) ; `x` 🦊'}),f=createCompletionFramer();const at=raw.indexOf(Buffer.from('🦊'))+1;assert.equal(f.push(raw.subarray(0,at)),null);assert.deepEqual(f.push(raw.subarray(at)),raw);f.eof();
 assert.throws(()=>createCompletionFramer().push(Buffer.concat([raw,raw])),/coalesced/);const partial=createCompletionFramer();partial.push(raw.subarray(0,-1));assert.throws(()=>partial.eof(),/unterminated/);assert.throws(()=>createCompletionFramer().push(Buffer.from('{"x":1,"x":2}\n')),/duplicate/);assert.throws(()=>createCompletionFramer({totalBytes:2}).push(raw),/aggregate/);
});
test('engine-caught bridge errors cannot permit controller submit or overwrite first fatal',async()=>{
 let submissions=0;const records=[];
 const out=await runCell({arm:'orchestrate-off',input:Readable.from([JSON.stringify({kind:'do',sequence:1,args:{instruction:'public'}})+'\n',JSON.stringify({kind:'submit',sequence:2})+'\n']),emit(){},journal:{append:e=>records.push(e)},createSession:async hooks=>({packet:{},async dispatch(){hooks.onFatal(Error('first bridge integrity fault'));hooks.onFatal(Error('later cleanup'));return {isError:true,text:'caught'};},async close(){throw Error('cleanup failed');}}),onSubmit(){submissions++;}});
 assert.equal(out.status,'incomplete');assert.equal(submissions,0);assert.match(out.reason,/first bridge integrity fault/);assert.equal(records.filter(e=>e.type==='result').length,0);assert.equal(records.filter(e=>e.type==='reserved').length,1);
});

test('IPC chunk boundaries do not turn adjacent trusted controls into a protocol fault',()=>{const first=encode({version:'one',text:'🦊'}),second=encode({version:'two'}),f=createCompletionIPCFramer();const bytes=Buffer.concat([first,second]);assert.equal(f.push(bytes.subarray(0,4)).length,0);assert.deepEqual(f.push(bytes.subarray(4)),[first,second]);f.eof();});

test('actual final CLI frame enforces both exact byte ceiling and combined output before delivery',()=>{
 const prefix=Buffer.byteLength(JSON.stringify({kind:'final-submission',submission:{text:''}})+'\n');
 const submission={text:'x'.repeat(COMPLETION_TRANSPORT_LIMITS.terminalReserveBytes-prefix)};
 const supervision={transportOutputBytes:COMPLETION_TRANSPORT_LIMITS.outputBytes-COMPLETION_TRANSPORT_LIMITS.terminalReserveBytes};
 const exact=encodeFinalSubmissionFrame(submission,supervision);assert.equal(exact.length,COMPLETION_TRANSPORT_LIMITS.terminalReserveBytes);
 assert.throws(()=>encodeFinalSubmissionFrame({text:submission.text+'x'},supervision),/frame too large/);
 assert.throws(()=>encodeFinalSubmissionFrame(submission,{transportOutputBytes:supervision.transportOutputBytes+1}),/combined output limit/);
 assert.throws(()=>encodeFinalSubmissionFrame({},{}),/combined output limit/);
});

test('sequential completions cannot renew the supervisor action deadline',async()=>{
 const s=setup();s.lane.beginAction({kind:'do',sequence:1});
 for(let n=1;n<=3;n++){
  const reservation={...reserve,completionSequence:n,completionId:'synthetic-sequential-'+n};
  await s.lane.worker(encode(reservation));const grant=s.worker.at(-1),request={...reservation,version:'native-completion-request-v1',capability:grant.capability,request:payload};await s.lane.worker(encode(request));
  const response={...reservation,version:'native-completion-response-v1',capability:grant.capability,message:{role:'assistant',content:'done'}};
  s.advance(100000);
  if(n<3)await s.lane.response(encode(response));else await assert.rejects(s.lane.response(encode(response)),/original action deadline/);
 }
 assert.equal(s.lane.snapshot.sequence,3);assert.equal(s.lane.snapshot.failed,true);assert.throws(()=>s.lane.endAction(),/original action deadline/);
});
