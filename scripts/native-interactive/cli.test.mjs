import {verifiedNode} from './check-runtime.mjs';
import {validateActionReceiptEvidence} from './action-receipt-files.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable,PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {digest,ARMS} from './protocol.mjs';
import {freezeCampaign,admitNext,preparePublicHandoff} from './coordinator.mjs';
import {verifyCellPublicHandoff} from './handoff-files.mjs';
import {runPublicBootstrap,verifyBootstrapOutput} from './bootstrap.mjs';
import {BOUNDS,supervise,sanitizedEnv,validateConfig,readConfig,awaitGroupExit,readLinuxProcessIdentity,verifyReadyLiveness,parseCoordinatorDispatchControl,COORDINATOR_CONTROL_BYTES,createReadyFrameForwarder} from './cli.mjs';
/** Test-only deadlock safety net, not the production action/assignment deadline. */
const SYNTHETIC_SETUP_WATCHDOG_MS=60000;
const venv=fs.realpathSync(process.env.AIW_VENV??[path.resolve(import.meta.dirname,'../../packages/tools/.venv'),'/opt/aiw/venv'].find(p=>fs.existsSync(path.join(p,'bin/python')))??'/opt/aiw/venv');
if(!fs.existsSync(path.join(venv,'bin/python')))throw new Error('verified Python venv required; set AIW_VENV');
function fixture(){const cellDir=fs.mkdtempSync(path.join(os.tmpdir(),'native-cli-test-'));const root=path.join(cellDir,'workspace');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'a.py'),'value = 1\n');const c={arm:'direct',root,allowedWritePaths:['a.py'],venv,cellDir,journalDir:path.join(cellDir,'journal')};saveConfig(c);return c;}
function saveConfig(c){const task='Synthetic local controller test, no native actor.\n';fs.writeFileSync(path.join(c.cellDir,'TASK.md'),task);fs.writeFileSync(path.join(c.cellDir,'config.json'),JSON.stringify(c)+'\n');fs.writeFileSync(path.join(c.cellDir,'admission.json'),JSON.stringify({testOnly:true,config:c,taskSHA256:digest(task)})+'\n');}
test('sanitized environment never copies arbitrary parent variables',()=>{process.env.NATIVE_TEST_PRIVATE='synthetic';try{const env=sanitizedEnv({venv},'/tmp/private');assert.equal(env.NATIVE_TEST_PRIVATE,undefined);assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.PATH,`${path.dirname(verifiedNode())}:/usr/local/bin:/usr/bin:/bin`);assert.equal(env.AIW_OFFLINE_CHECKS,'1');}finally{delete process.env.NATIVE_TEST_PRIVATE;}});
test('finite supervisor runs actual read then accepts provisional submit after cleanup',async()=>{
 const c=fixture();let out='',err='';try{const result=await supervise(c,{input:Readable.from([JSON.stringify({kind:'tools',sequence:1,calls:[{name:'readFile',args:{path:'a.py'}}]})+'\n'+JSON.stringify({kind:'submit',sequence:2})+'\n']),stdout:s=>out+=s,stderr:s=>err+=s});assert.equal(result.status,'submitted',JSON.stringify({result,err}));assert.equal(result.cleanup,'closed');assert.equal(result.timing.assignmentLimitMs,900000);assert.ok(result.timing.elapsedMs>=0);assert.ok(result.timing.observations.some(e=>e.type==='worker-spawn'));assert.ok(result.timing.observations.some(e=>e.type==='ready-delivered'));const start=JSON.parse(fs.readFileSync(path.join(c.cellDir,'supervisor-start.json')));assert.equal(start.assignmentLimitMs,900000);assert.equal(start.deadlineMonotonicMs-start.startedMonotonicMs,900000);assert.equal(start.configSHA256,result.configSHA256);const ready=JSON.parse(fs.readFileSync(path.join(c.cellDir,'supervisor-ready.json')));assert.equal(ready.supervisorStartSHA256,digest(fs.readFileSync(path.join(c.cellDir,'supervisor-start.json'))));assert.equal(ready.configSHA256,result.configSHA256);assert.ok(ready.monotonicMs>=start.startedMonotonicMs);assert.match(out,/value = 1/);assert.equal(JSON.parse(fs.readFileSync(path.join(c.cellDir,'supervisor-result.json'))).status,'submitted');await assert.rejects(supervise(c),/already attempted/);}finally{fs.rmSync(c.cellDir,{recursive:true,force:true});}
});
test('EOF without submission remains incomplete',async()=>{const c=fixture();try{const result=await supervise(c,{input:Readable.from([]),stdout(){},stderr(){}});assert.equal(result.status,'incomplete');assert.equal(result.cleanup,'uncertain');}finally{fs.rmSync(c.cellDir,{recursive:true,force:true});}});
test('fixed wall deadline includes idle time after ready and never claims cleanup certainty',async()=>{
 const c=fixture(),input=new PassThrough();let elapsed=0,expire,ready=false;const timers=new Map();let id=0;
 const clock={now:()=>elapsed,setTimeout(fn,ms){if(ms===BOUNDS.wallMs){expire=fn;return ++id;}const key=++id;timers.set(key,setTimeout(fn,ms));return key;},clearTimeout(key){clearTimeout(timers.get(key));timers.delete(key);}};
 try{const result=await supervise(c,{clock,input,stdout(chunk){if(String(chunk).includes('"kind":"ready"')){ready=true;elapsed=BOUNDS.wallMs;expire();}},stderr(){}});assert.equal(ready,true);assert.equal(BOUNDS.wallMs,900000);assert.equal(result.status,'incomplete');assert.equal(result.cleanup,'uncertain');assert.match(result.reason,/timeout/);assert.equal(result.timing.elapsedMs,900000);}finally{input.destroy();fs.rmSync(c.cellDir,{recursive:true,force:true});}
});
test('bad timeout and symlinked config rejected before worker launch',()=>{const c=fixture();try{for(const wallTimeoutMs of [100,900000,900001])assert.throws(()=>validateConfig({...c,wallTimeoutMs}),/invalid config/);const target=path.join(c.cellDir,'config.json');fs.writeFileSync(target,JSON.stringify(c));fs.symlinkSync(target,path.join(c.cellDir,'link.json'));assert.throws(()=>readConfig(path.join(c.cellDir,'link.json')));}finally{fs.rmSync(c.cellDir,{recursive:true,force:true});}});

test('supervised actual Python sidecar has no inherited synthetic secret',async()=>{
 const c=fixture();let err='';process.env.NATIVE_CLI_SECRET='synthetic';fs.writeFileSync(path.join(c.root,'test_env.py'),'import unittest,os\nclass Test(unittest.TestCase):\n def test_env(self):\n  self.assertNotIn("NATIVE_CLI_SECRET",os.environ)\n');
 try{const input=Readable.from([JSON.stringify({kind:'tools',sequence:1,calls:[{name:'runTests',args:{target:'test_env.py',timeoutMs:10000}}]})+'\n'+JSON.stringify({kind:'submit',sequence:2})+'\n']);let out='';const result=await supervise(c,{input,stdout:s=>out+=s,stderr:s=>err+=s});assert.equal(result.status,'submitted',JSON.stringify({result,err}));const feedback=out.trim().split('\n').map(JSON.parse).find(x=>x.kind==='result');assert.equal(feedback.result[0].isError,false);assert.equal(JSON.parse(feedback.result[0].text).passed,1);}finally{delete process.env.NATIVE_CLI_SECRET;fs.rmSync(c.cellDir,{recursive:true,force:true});}
});

test('rejected asynchronous feedback callback makes run incomplete',async()=>{const c=fixture();try{const result=await supervise(c,{input:Readable.from([JSON.stringify({kind:'submit',sequence:1})+'\n']),stdout:async()=>{throw new Error('delivery rejected');},stderr(){}});assert.equal(result.status,'incomplete');assert.equal(result.cleanup,'uncertain');assert.match(result.reason,/callback failed/);}finally{fs.rmSync(c.cellDir,{recursive:true,force:true});}});
test('input byte overflow stops worker before accepting any outcome',async()=>{const c=fixture();try{const result=await supervise(c,{input:Readable.from([Buffer.alloc(1300000,32)]),stdout(){},stderr(){}});assert.equal(result.status,'incomplete');assert.equal(result.cleanup,'uncertain');assert.match(result.reason,/input overflow/);}finally{fs.rmSync(c.cellDir,{recursive:true,force:true});}});
test('unresolved feedback delivery has a bounded failure path',async()=>{const c=fixture();try{const result=await supervise(c,{input:Readable.from([JSON.stringify({kind:'submit',sequence:1})+'\n']),stdout:()=>new Promise(()=>{}),stderr(){}});assert.equal(result.status,'incomplete');assert.equal(result.cleanup,'uncertain');assert.match(result.reason,/drain uncertain/);}finally{fs.rmSync(c.cellDir,{recursive:true,force:true});}});

test('group grace policy distinguishes natural disappearance from persistence',async()=>{
 let clock=0;const natural=await awaitGroupExit(123,100,{inspect:()=>({members:[],complete:true}),probe:()=>clock<50,now:()=>clock,sleep:async ms=>{clock+=ms;}});assert.equal(natural.absent,true);assert.equal(clock,50);
 clock=0;const persists=await awaitGroupExit(123,100,{inspect:()=>({members:[],complete:true}),probe:()=>true,now:()=>clock,sleep:async ms=>{clock+=ms;}});assert.equal(persists.absent,false);assert.equal(clock,100);
});

/** Synthetic process observations do not establish anything about other executor namespaces. */
function identityFixture(){
 const base={parentPid:1,processGroupId:1,startTimeTicks:'100',state:'S',pidNamespace:'pid:[1]',mountNamespace:'mnt:[2]',timeNamespace:null,bootId:'12345678-1234-1234-1234-123456789abc'};
 const supervisor={...base,pid:10},worker={...base,pid:11,parentPid:10,processGroupId:11,startTimeTicks:'101'},observer={...base,pid:12,startTimeTicks:'102'};
 const start={kind:'supervisor-launch-observation',startedMonotonicMs:1000,assignmentLimitMs:900000,deadlineMonotonicMs:901000,supervisorIdentity:supervisor};
 const ready={kind:'supervisor-ready-acknowledgement',monotonicMs:2000,processes:{supervisor,worker}};
 const current=new Map([[10,supervisor],[11,worker],[12,observer]]);
 return {start,ready,current,options:{now:()=>3000,currentPID:10,readIdentity:pid=>{if(!current.has(pid))throw Error('process observation unavailable');return current.get(pid);}}};
}

test('readiness identity rejects stale, missing, reused and unknown process observations',()=>{
 const f=identityFixture();assert.equal(verifyReadyLiveness(f,f.options).status,'live');
 for(const mutate of [x=>x.current.delete(11),x=>x.current.set(11,{...x.current.get(11),startTimeTicks:'999'}),x=>x.current.set(10,{...x.current.get(10),state:'Z'}),x=>x.current.set(10,{...x.current.get(10),bootId:'unknown'})]){const x=identityFixture();mutate(x);assert.throws(()=>verifyReadyLiveness(x,x.options));}
 for(const now of [901000,901001,1999,NaN]){const x=identityFixture();assert.throws(()=>verifyReadyLiveness(x,{...x.options,now:()=>now}),/expired|clock/);}
 const reset=identityFixture();reset.start.deadlineMonotonicMs++;assert.throws(()=>verifyReadyLiveness(reset,reset.options),/deadline/);
});

test('readiness identity requires observed namespace and cross-process clock comparability',()=>{
 for(const key of ['pidNamespace','mountNamespace']){const x=identityFixture();x.current.set(10,{...x.current.get(10),[key]:key==='pidNamespace'?'pid:[9]':'mnt:[9]'});assert.throws(()=>verifyReadyLiveness(x,x.options),/namespace/);}
 const unknown=identityFixture();assert.throws(()=>verifyReadyLiveness(unknown,{...unknown.options,currentPID:12}),/comparability unknown/);
 const matching=identityFixture();for(const p of matching.current.values())p.timeNamespace='time:[3]';assert.equal(verifyReadyLiveness(matching,{...matching.options,currentPID:12}).clockScope,'observed matching Linux time namespace');
 matching.current.get(12).timeNamespace='time:[4]';assert.throws(()=>verifyReadyLiveness(matching,{...matching.options,currentPID:12}),/comparability unknown/);
});

test('bounded process parser records missing time namespace without claiming it is known',()=>{
 const stat='10 (example name) S 1 10 '+Array(16).fill('0').join(' ')+' 123 0\n';
 const options={readText(file){return file.endsWith('/stat')?stat:'12345678-1234-1234-1234-123456789abc\n';},readlink(file){if(file.endsWith('/time'))throw Object.assign(Error('missing'),{code:'ENOENT'});return file.endsWith('/pid')?'pid:[1]':'mnt:[2]';}};
 const observed=readLinuxProcessIdentity(10,options);assert.equal(observed.startTimeTicks,'123');assert.equal(observed.timeNamespace,null);
 assert.throws(()=>readLinuxProcessIdentity(10,{...options,readText:file=>file.endsWith('/stat')?stat.replace(') S ',') Z '):options.readText(file)}),/non-live/);
});

test('live ready identity is verified only inside the actual supervisor process and expires after close',async()=>{
 const c=fixture(),input=new PassThrough();let signalReady;const readySeen=new Promise(resolve=>{signalReady=resolve});let err='';
 const running=supervise(c,{input,stdout(chunk){if(String(chunk).includes('"kind":"ready"'))signalReady();},stderr:s=>{err+=s;}});
 try{
  await Promise.race([readySeen,running.then(result=>{throw Error('supervisor ended before ready: '+JSON.stringify({result,err}));})]);
  await new Promise(resolve=>setImmediate(resolve));
  const start=JSON.parse(fs.readFileSync(path.join(c.cellDir,'supervisor-start.json'))),ready=JSON.parse(fs.readFileSync(path.join(c.cellDir,'supervisor-ready.json')));
  const observed=verifyReadyLiveness({start,ready});assert.equal(observed.status,'live');assert.equal(observed.clockScope,'same supervisor process');assert.equal(observed.supervisor.pid,process.pid);assert.equal(observed.worker.parentPid,process.pid);
  input.end(JSON.stringify({kind:'submit',sequence:1})+'\n');const result=await running;assert.equal(result.status,'submitted',JSON.stringify({result,err}));assert.throws(()=>verifyReadyLiveness({start,ready}));
 }finally{input.end();await running;fs.rmSync(c.cellDir,{recursive:true,force:true});}
});

test('coordinator dispatch control schema is exact, bounded and contains no actor prompt',()=>{
 const expected={actorId:'synthetic-actor',assignmentSHA256:'a'.repeat(64),handoffSHA256:'c'.repeat(64),capabilitySHA256:'d'.repeat(64)},request={kind:'coordinator-dispatch-intent',...expected},frame=JSON.stringify(request)+'\n';
 assert.deepEqual(parseCoordinatorDispatchControl(frame,expected),request);assert.equal(COORDINATOR_CONTROL_BYTES,4096);
 for(const value of [frame+'\n',frame+'{}\n',frame.slice(0,-1),JSON.stringify({...request,prompt:'hidden instructions'})+'\n',JSON.stringify({...request,actorId:'different'})+'\n',JSON.stringify({...request,assignmentSHA256:'b'.repeat(64)})+'\n',Buffer.alloc(4097,10),Buffer.from([255,10])])assert.throws(()=>parseCoordinatorDispatchControl(value,expected));
});

/** Exercise native-mode transport mechanics with explicit synthetic evidence and no actor launch. */
function nativeControlFixture(arm='direct'){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'native-bootstrap-control-')),campaignDir=path.join(base,'campaign');
 fs.writeFileSync(path.join(base,'control-kind.json'),JSON.stringify({testOnly:true,kind:'synthetic-bootstrap-control',nativeActorDispatched:false})+'\n');
 freezeCampaign({campaignDir,cells:[{id:'cell',fixtureId:'calendar-window',arm}],evidenceMode:'native-assignment'});
 const c=admitNext({campaignDir,index:0,venv,actorId:'synthetic-actor-no-native-dispatch'});
 const request={kind:'coordinator-dispatch-intent',actorId:'synthetic-actor-no-native-dispatch',assignmentSHA256:digest(fs.readFileSync(path.join(c.cellDir,'assignment.json'))),handoffSHA256:'0'.repeat(64),capabilitySHA256:'0'.repeat(64)};
 const prepare=()=>{const handoff=preparePublicHandoff({cellDir:c.cellDir});assert.ok(handoff.bootstrapInstruction.includes('requesting yield_time_ms=30000 and max_output_tokens='+handoff.expectedBootstrapOutputBytes));assert.ok(handoff.bootstrapInstruction.includes('nonterminal, session-only, truncated'));assert.ok(handoff.bootstrapInstruction.includes('report incomplete to the coordinator via collaboration.send_message and END the turn. Do not poll, call write_stdin, repeat exec_command, or use another reader.'));assert.ok(handoff.bootstrapInstruction.endsWith(handoff.bootstrapCommand+'\n'));request.handoffSHA256=handoff.handoffSHA256;request.capabilitySHA256=handoff.capabilitySHA256;return JSON.stringify(request)+'\n';};
 return {c,base,request,frame:JSON.stringify(request)+'\n',prepare};
}
async function emitBootstrapForTest(c){return runPublicBootstrap({capabilityPath:path.join(c.cellDir,'public-bootstrap.json'),expectedCapabilitySHA256:digest(fs.readFileSync(path.join(c.cellDir,'public-bootstrap.json'))),emit:async output=>({bytes:output.length,sha256:digest(output)})});}

test('synthetic coordinator control acknowledges once and separates overhead from actor bytes',async()=>{
 const {c,request,prepare}=nativeControlFixture(),input=new PassThrough();let signalReady,signalAck,intents=0,frame;const readySeen=new Promise(r=>{signalReady=r}),ackSeen=new Promise(r=>{signalAck=r});let err='';
 const running=supervise(c,{input,stdout(chunk){const text=String(chunk);if(text.includes('"kind":"ready"'))signalReady();if(text.includes('"kind":"coordinator-dispatch-intent-ack"'))signalAck(JSON.parse(text));if(text.includes('"kind":"submitted"'))setImmediate(()=>input.end());},stderr:s=>{err+=s;},recordDispatchIntent(options){intents++;assert.equal(options.assignmentSHA256,request.assignmentSHA256);fs.writeFileSync(path.join(c.cellDir,'actor-dispatch-intent.json'),JSON.stringify({testOnly:true,...options,handoff:verifyCellPublicHandoff({cellDir:c.cellDir})})+'\n',{flag:'wx'});}});
 try{
  await Promise.race([readySeen,running.then(result=>{throw Error('ended before ready: '+JSON.stringify({result,err}));})]);await new Promise(r=>setImmediate(r));frame=prepare();input.write(frame);
  const ack=await Promise.race([ackSeen,running.then(result=>{throw Error('ended before ack: '+JSON.stringify({result,err}));})]);await new Promise(r=>setImmediate(r));
  assert.equal(ack.actorId,request.actorId);assert.ok(ack.remainingMs>0&&ack.remainingMs<=900000);await emitBootstrapForTest(c);const submit=JSON.stringify({kind:'submit',sequence:1})+'\n';input.write(submit);
  const result=await running;assert.equal(result.status,'submitted',JSON.stringify({result,err}));assert.equal(intents,1);assert.equal(result.coordinatorControls,1);assert.equal(result.coordinatorInputBytes,Buffer.byteLength(frame));assert.ok(result.coordinatorOutputBytes>0);assert.equal(result.bytesIn,Buffer.byteLength(submit));assert.equal(result.bytesOut,result.outcome.confirmedOutputBytes);const ackEvent=result.timing.observations.find(e=>e.type==='coordinator-control-ack'),actorEvent=result.timing.observations.find(e=>e.type==='actor-input-start');assert.equal(ackEvent.assignmentSHA256,request.assignmentSHA256);assert.ok(actorEvent.monotonicMs>=ackEvent.monotonicMs);assert.equal(result.timing.observations.filter(e=>e.type==='actor-input-start').length,1);
 }finally{input.end();await running;fs.rmSync(c.cellDir,{recursive:true,force:true});}
});

test('synthetic native control rejects actor bytes pipelined before its acknowledgement',async()=>{
 const {c,prepare}=nativeControlFixture(),input=new PassThrough();let signalReady,intents=0;const readySeen=new Promise(r=>{signalReady=r});
 const running=supervise(c,{input,stdout(chunk){if(String(chunk).includes('"kind":"ready"'))signalReady();},stderr(){},recordDispatchIntent(){intents++;}});
 try{await Promise.race([readySeen,running.then(result=>{throw Error('ended before ready: '+JSON.stringify(result));})]);await new Promise(r=>setImmediate(r));input.write(prepare()+JSON.stringify({kind:'submit',sequence:1})+'\n');const result=await running;assert.equal(result.status,'incomplete');assert.match(result.reason,/pipelined/);assert.equal(intents,0);assert.equal(result.bytesIn,0);}finally{input.end();await running;fs.rmSync(c.cellDir,{recursive:true,force:true});}
});

test('synthetic native control arriving before ready executes no coordinator effect',async()=>{
 const {c,frame}=nativeControlFixture();let intents=0;
 try{const result=await supervise(c,{input:Readable.from([frame]),stdout(){},stderr(){},recordDispatchIntent(){intents++;}});assert.equal(result.status,'incomplete');assert.match(result.reason,/before ready/);assert.equal(intents,0);assert.equal(result.bytesIn,0);}finally{fs.rmSync(c.cellDir,{recursive:true,force:true});}
});

test('synthetic native control expiry after intent prevents acknowledgement and actor effects',async()=>{
 const {c,prepare}=nativeControlFixture(),input=new PassThrough();let elapsed=0,signalReady,intents=0,acks=0;const readySeen=new Promise(r=>{signalReady=r});
 const running=supervise(c,{clock:{now:()=>elapsed,setTimeout,clearTimeout},input,stdout(chunk){const text=String(chunk);if(text.includes('"kind":"ready"'))signalReady();if(text.includes('"kind":"coordinator-dispatch-intent-ack"'))acks++;},stderr(){},recordDispatchIntent(options){intents++;fs.writeFileSync(path.join(c.cellDir,'actor-dispatch-intent.json'),JSON.stringify({testOnly:true,...options,handoff:verifyCellPublicHandoff({cellDir:c.cellDir})})+'\n',{flag:'wx'});elapsed=900000;}});
 try{await Promise.race([readySeen,running.then(result=>{throw Error('ended before ready: '+JSON.stringify(result));})]);await new Promise(r=>setImmediate(r));input.write(prepare());const result=await running;assert.equal(result.status,'incomplete');assert.match(result.reason,/expired/);assert.equal(intents,1);assert.equal(acks,0);assert.equal(result.bytesIn,0);}finally{input.end();await running;fs.rmSync(c.cellDir,{recursive:true,force:true});}
});

/** Native-only fail-closed controls; no actor or native receipt is manufactured. */
for(const fault of ['reservation-collision','malformed-utf8','pending-eof','rejected-pair','hanging-pair'])test(`native action receipt rejects ${fault} without accepting terminal evidence`,async t=>{
 const {c,base,prepare}=nativeControlFixture(),input=new PassThrough();t.diagnostic(`Retained receipt failure control: ${base}`);let signalReady,signalAck;const readySeen=new Promise(r=>{signalReady=r}),ackSeen=new Promise(r=>{signalAck=r});let err='',elapsed=0,expireAssignment,settleLate,pairEntered=false,fallbackExpired=false;const assignmentHandle={};
 const clock={now:()=>elapsed,setTimeout(fn,ms){if(ms===BOUNDS.wallMs){expireAssignment=fn;return assignmentHandle;}return setTimeout(fn,ms);},clearTimeout(handle){if(handle!==assignmentHandle)clearTimeout(handle);}};
 const fallback=fault==='hanging-pair'?setTimeout(()=>{fallbackExpired=true;elapsed=BOUNDS.wallMs;expireAssignment?.();},SYNTHETIC_SETUP_WATCHDOG_MS):undefined;
 const running=supervise(c,{...(fault==='hanging-pair'?{clock}:{}),input,stdout(chunk){const text=String(chunk);if(text.includes('"kind":"ready"'))signalReady();if(text.includes('"kind":"coordinator-dispatch-intent-ack"'))signalAck();if(text.includes('"kind":"coordinator-action-receipt"')){if(fault==='rejected-pair')throw Error('synthetic paired transport rejection');if(fault==='hanging-pair'){pairEntered=true;queueMicrotask(()=>{elapsed=BOUNDS.wallMs;expireAssignment();});return new Promise(resolve=>{settleLate=resolve;});}}},stderr:chunk=>{err+=chunk;},recordDispatchIntent(options){fs.writeFileSync(path.join(c.cellDir,'actor-dispatch-intent.json'),JSON.stringify({testOnly:true,...options,handoff:verifyCellPublicHandoff({cellDir:c.cellDir})})+'\n',{flag:'wx'});}});
 try{
  await Promise.race([readySeen,running.then(result=>{throw Error('ended before ready: '+JSON.stringify({result,err}));})]);await new Promise(r=>setImmediate(r));input.write(prepare());
  await Promise.race([ackSeen,running.then(result=>{throw Error('ended before acknowledgement: '+JSON.stringify({result,err}));})]);await new Promise(r=>setImmediate(r));await emitBootstrapForTest(c);
  if(fault==='reservation-collision')fs.writeFileSync(path.join(c.cellDir,'action-receipts/000001.input.json'),'existing exclusive reservation');
  const raw=fault==='malformed-utf8'?Buffer.from([0xc3,0x28,10]):Buffer.from('{"kind":"submit","sequence":1}\n');
  if(fault==='pending-eof')input.end(raw);else input.write(raw);
  const result=await running;if(fault==='hanging-pair'){assert.equal(fallbackExpired,false,'test-only pre-emission fallback fired; not successful coverage');assert.equal(pairEntered,true);assert.match(result.reason,/wall timeout/);assert.ok(result.timing.observations.some(event=>event.type==='assignment-timeout'));const terminalSHA256=digest(fs.readFileSync(path.join(c.cellDir,'supervisor-result.json')));settleLate();await new Promise(r=>setImmediate(r));assert.equal(digest(fs.readFileSync(path.join(c.cellDir,'supervisor-result.json'))),terminalSHA256);assert.equal(fs.existsSync(path.join(c.cellDir,'action-receipts/000001.ack.json')),false);}fs.writeFileSync(path.join(base,'test-control-result.json'),JSON.stringify({fault,result,err})+'\n');assert.equal(result.status,'incomplete');assert.equal(result.cleanup,'uncertain');assert.equal(result.actionReceipts.acknowledgedCount,0);assert.equal(fs.existsSync(path.join(c.cellDir,'action-receipts/000001.ack.json')),false);
  assert.equal(fs.existsSync(path.join(c.cellDir,'submission-result.json')),false);assert.equal(fs.existsSync(path.join(c.cellDir,'grade.json')),false);
  if(['reservation-collision','malformed-utf8'].includes(fault)){const events=fs.readdirSync(c.journalDir).map(name=>JSON.parse(fs.readFileSync(path.join(c.journalDir,name))));assert.equal(events.some(e=>e.type==='reserved'||e.type==='host-attempt'),false);}
 }finally{clearTimeout(fallback);input.end();await running;}
});

/** Model coordinator observations of incremental tool output using real supervisor pairs.
 * The synthetic session ID is not an external exec-server liveness/reliability claim.
 * No reader, queue, model transport or observation API is added to production code.
 */
for(const completion of ['complete','deadline'])test(`ordinary same-session observations remain pending until ${completion}`,async t=>{
 const {c,base,prepare}=nativeControlFixture(),input=new PassThrough();t.diagnostic(`Retained ordinary observation control: ${base}`);
 let elapsed=0,expireAssignment,fallbackExpired=false,signalReady,signalAck,signalPair,releasePair,result,err='';const assignmentHandle={};
 const readySeen=new Promise(r=>{signalReady=r}),ackSeen=new Promise(r=>{signalAck=r}),pairSeen=new Promise(r=>{signalPair=r});
 const clock={now:()=>elapsed,setTimeout(fn,ms){if(ms===BOUNDS.wallMs){expireAssignment=fn;return assignmentHandle;}return setTimeout(fn,ms);},clearTimeout(handle){if(handle!==assignmentHandle)clearTimeout(handle);}};
 const fallback=setTimeout(()=>{fallbackExpired=true;elapsed=BOUNDS.wallMs;expireAssignment?.();},SYNTHETIC_SETUP_WATCHDOG_MS);
 const running=supervise(c,{clock,input,stdout(chunk){
  const raw=Buffer.from(chunk),text=raw.toString('utf8');if(text.includes('"kind":"ready"'))signalReady();if(text.includes('"kind":"coordinator-dispatch-intent-ack"'))signalAck();
  if(text.includes('"kind":"coordinator-action-receipt"')){
   const firstLF=raw.indexOf(10),receipt=JSON.parse(raw.subarray(0,firstLF));
   if(receipt.sequence===1){signalPair(raw);return new Promise(resolve=>{releasePair=resolve;});}
   assert.equal(receipt.sequence,2);assert.equal(receipt.actionKind,'submit');assert.equal(receipt.feedbackSHA256,digest(raw.subarray(firstLF+1)));assert.equal(JSON.parse(raw.subarray(firstLF+1)).kind,'submitted');setImmediate(()=>input.end());
  }
 },stderr:chunk=>{err+=chunk;},recordDispatchIntent(options){fs.writeFileSync(path.join(c.cellDir,'actor-dispatch-intent.json'),JSON.stringify({testOnly:true,...options,handoff:verifyCellPublicHandoff({cellDir:c.cellDir})})+'\n',{flag:'wx'});}});
 try{
  const beforeTerminal=promise=>Promise.race([promise,running.then(result=>{throw Error('ended before observation setup: '+JSON.stringify({result,err}));})]);
  await beforeTerminal(readySeen);await new Promise(r=>setImmediate(r));input.write(prepare());await beforeTerminal(ackSeen);await new Promise(r=>setImmediate(r));await emitBootstrapForTest(c);
  const intended=Buffer.from(' {"sequence":1,"kind":"tools","calls":[{"name":"readFile","args":{"path":"window.py"}}]}\r\n');
  fs.writeFileSync(path.join(base,'intended-action-1.jsonl'),intended,{flag:'wx'});input.write(intended);let sends=1;
  const pair=await beforeTerminal(pairSeen);fs.writeFileSync(path.join(base,'observed-pair.jsonl'),pair,{flag:'wx'});
  const expected={assignmentSHA256:digest(fs.readFileSync(path.join(c.cellDir,'assignment.json'))),admissionSHA256:digest(fs.readFileSync(path.join(c.cellDir,'admission.json'))),configSHA256:digest(fs.readFileSync(path.join(c.cellDir,'config.json'))),supervisorStartSHA256:digest(fs.readFileSync(path.join(c.cellDir,'supervisor-start.json'))),dispatchIntentSHA256:digest(fs.readFileSync(path.join(c.cellDir,'actor-dispatch-intent.json')))};
  const sessionId=71001,observations=[],relayed=[];let buffered=Buffer.alloc(0),state='pending';
  // Each observation is NEW output from the same in-flight handle, never a cumulative replay.
  const observe=({session_id,output,terminal=false})=>{
   observations.push({session_id,chars:'',bytes:output.length,terminal,elapsed});
   if(state!=='pending')throw Error('observation after incomplete/complete');
   if(session_id!==sessionId||elapsed>=BOUNDS.wallMs){state='incomplete';throw Error('session/deadline incomplete');}
   buffered=Buffer.concat([buffered,output]);assert.ok(buffered.length<=4096+98304);
   const firstLF=buffered.indexOf(10),lastLF=firstLF<0?-1:buffered.indexOf(10,firstLF+1);
   if(lastLF<0){if(terminal){state='incomplete';throw Error('terminal missing pair');}return state;}
   assert.equal(lastLF,buffered.length-1);const receiptRaw=buffered.subarray(0,firstLF+1),feedback=buffered.subarray(firstLF+1);
   const receipt=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(receiptRaw));
   assert.equal(receipt.kind,'coordinator-action-receipt');assert.equal(receipt.version,'native-action-receipt-v1');assert.equal(receipt.scope,'coordinator byte observation; not native authorship or atomic delivery');
   for(const [key,value] of Object.entries(expected))assert.equal(receipt[key],value);
   assert.equal(receipt.sequence,1);assert.equal(receipt.actionKind,'tools');assert.equal(receipt.inputSHA256,digest(intended));assert.equal(receipt.inputBytes,intended.length);assert.equal(receipt.feedbackSHA256,digest(feedback));assert.equal(receipt.feedbackBytes,feedback.length);
   const value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(feedback));assert.equal(value.kind,'result');assert.equal(value.sequence,1);
   state='complete';relayed.push(Buffer.from(feedback));return state;
  };
  assert.equal(observe({session_id:sessionId,output:Buffer.alloc(0)}),'pending');assert.equal(relayed.length,0);assert.equal(sends,1);
  elapsed=1;const split=pair.indexOf(10)+7;assert.equal(observe({session_id:sessionId,output:pair.subarray(0,split)}),'pending');assert.equal(relayed.length,0);assert.equal(sends,1);
  elapsed=2;assert.equal(observe({session_id:sessionId,output:Buffer.alloc(0)}),'pending');assert.equal(relayed.length,0);
  if(completion==='complete'){
   assert.equal(observe({session_id:sessionId,output:pair.subarray(split)}),'complete');assert.equal(relayed.length,1);assert.deepEqual(relayed[0],pair.subarray(pair.indexOf(10)+1));assert.equal(sends,1);
   releasePair();await new Promise(r=>setImmediate(r));const submit=Buffer.from('{"sequence":2,"kind":"submit"}\n');fs.writeFileSync(path.join(base,'intended-action-2.jsonl'),submit,{flag:'wx'});input.write(submit);sends++;
   result=await running;assert.equal(result.status,'submitted',JSON.stringify({result,err}));assert.equal(result.cleanup,'closed');assert.equal(result.actionReceipts.receivedCount,2);assert.equal(result.actionReceipts.acknowledgedCount,2);assert.equal(validateActionReceiptEvidence({cellDir:c.cellDir,supervision:result}).count,2);
  }else{
   elapsed=BOUNDS.wallMs;expireAssignment();result=await running;assert.equal(result.status,'incomplete');assert.equal(result.cleanup,'uncertain');assert.match(result.reason,/wall timeout/);assert.ok(result.timing.observations.some(event=>event.type==='assignment-timeout'));
   assert.throws(()=>observe({session_id:sessionId,output:pair.subarray(split)}),/deadline incomplete/);assert.equal(state,'incomplete');assert.equal(relayed.length,0);assert.equal(sends,1);
   const terminalSHA256=digest(fs.readFileSync(path.join(c.cellDir,'supervisor-result.json')));releasePair();await new Promise(r=>setImmediate(r));assert.equal(digest(fs.readFileSync(path.join(c.cellDir,'supervisor-result.json'))),terminalSHA256);assert.equal(fs.existsSync(path.join(c.cellDir,'action-receipts/000001.ack.json')),false);assert.equal(result.actionReceipts.acknowledgedCount,0);
  }
  assert.equal(fallbackExpired,false,'setup fallback fired; not valid observation coverage');assert.ok(observations.every(observation=>observation.session_id===sessionId&&observation.chars===''));assert.equal(result.timing.assignmentLimitMs,900000);
  const start=JSON.parse(fs.readFileSync(path.join(c.cellDir,'supervisor-start.json')));assert.equal(start.deadlineMonotonicMs-start.startedMonotonicMs,900000);assert.equal(result.bytesIn,fs.readFileSync(path.join(base,'intended-action-1.jsonl')).length+(completion==='complete'?fs.readFileSync(path.join(base,'intended-action-2.jsonl')).length:0));
  for(const name of ['actor-dispatch-receipt.json','submission-result.json','grade.json'])assert.equal(fs.existsSync(path.join(c.cellDir,name)),false);
  fs.writeFileSync(path.join(base,'test-observation-result.json'),JSON.stringify({testOnly:true,externalTransportVerified:false,completion,state,sends,relayedCount:relayed.length,observations,result,err})+'\n',{flag:'wx'});
 }finally{if(!result){elapsed=BOUNDS.wallMs;expireAssignment?.();}releasePair?.();input.end();await running;clearTimeout(fallback);}
});

/** Exercise module evaluation as the real executable, not an already-imported library.
 * The retained one-cell campaign is explicitly synthetic; no native actor or native receipt is created.
 */
for(const arm of ARMS.filter(a=>!a.startsWith('orchestrate-')))test(`executable CLI pairs exact raw action receipts with unchanged feedback (${arm})`,async t=>{
 const {c,base,request,prepare}=nativeControlFixture(arm),cellDir=c.cellDir,actorId=request.actorId,assignmentSHA256=request.assignmentSHA256;
 t.diagnostic(`Retained executable receipt evidence: ${base}`);
 const query={pattern:'query_events|café 🐢',path:'window.py'};
 const first=arm==='direct'?{kind:'tools',sequence:1,calls:[{name:'grep',args:query}]}:{kind:'branch',sequence:1,code:'async (tools) => await tools.grep('+JSON.stringify(query)+')'};
 const intended=[Buffer.from(' '+JSON.stringify(first)+'\r\n'),Buffer.from(' {"sequence":2,"kind":"submit"}\n')];
 for(let i=0;i<intended.length;i++)fs.writeFileSync(path.join(base,`intended-action-${i+1}.jsonl`),intended[i],{flag:'wx'});
 const command=[path.resolve(import.meta.dirname,'cli.mjs'),path.join(cellDir,'config.json')];
 const child=spawn(process.execPath,command,{cwd:path.resolve(import.meta.dirname,'../..'),stdio:['pipe','pipe','pipe'],detached:true});
 let stderr='',pending=Buffer.alloc(0),sent=false,ack,watchdogExpired=false,handlerError,bootstrapProcess,pairedReceipt,feedbackCount=0;
 const receipts=[];
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 const watchdog=setTimeout(()=>{watchdogExpired=true;try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')handlerError??=error;}},SYNTHETIC_SETUP_WATCHDOG_MS);
 const record=(name,text)=>fs.appendFileSync(path.join(base,name),text);
 const sendAction=index=>{const raw=intended[index];if(index===0){const split=raw.indexOf(Buffer.from('🐢'))+2;child.stdin.write(raw.subarray(0,split));child.stdin.write(raw.subarray(split,-1));child.stdin.write(raw.subarray(-1));}else child.stdin.write(raw);};
 child.stdin.on('error',error=>{handlerError??=error;});
 child.stderr.on('data',chunk=>{stderr+=chunk;record('stderr.log',chunk);});
 child.stdout.on('data',chunk=>{
  record('stdout.log',chunk);pending=Buffer.concat([pending,chunk]);
  try{let newline;while((newline=pending.indexOf(10))>=0){const raw=pending.subarray(0,newline+1);pending=pending.subarray(newline+1);const message=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw));
   if(message.kind==='coordinator-dispatch-intent-ack'){
    if(ack)throw Error('duplicate acknowledgement');ack=message;
    bootstrapProcess=spawn(process.execPath,[path.resolve(import.meta.dirname,'bootstrap.mjs'),path.join(cellDir,'public-bootstrap.json'),request.capabilitySHA256],{stdio:['ignore','pipe','pipe']});const chunks=[];let bootstrapError='';
    bootstrapProcess.stdout.on('data',chunk=>{chunks.push(chunk);record('bootstrap-output.log',chunk);});bootstrapProcess.stderr.on('data',chunk=>{bootstrapError+=chunk;record('bootstrap-stderr.log',chunk);});
    bootstrapProcess.once('error',error=>{handlerError??=error;child.stdin.end();});bootstrapProcess.once('close',code=>{try{if(code!==0)throw Error(`bootstrap exited ${code}: ${bootstrapError}`);verifyBootstrapOutput({output:Buffer.concat(chunks),payload:fs.readFileSync(path.join(cellDir,'public-handoff.txt')),manifest:JSON.parse(fs.readFileSync(path.join(cellDir,'public-handoff.json'))),capabilitySHA256:request.capabilitySHA256});sendAction(0);}catch(error){handlerError??=error;child.stdin.end();}});
   }else if(message.kind==='coordinator-action-receipt'){
    if(pairedReceipt)throw Error('duplicate or unpaired action receipt');assert.equal(message.sequence,feedbackCount+1);assert.equal(message.assignmentSHA256,assignmentSHA256);assert.equal(message.inputSHA256,digest(intended[feedbackCount]));assert.equal(message.inputBytes,intended[feedbackCount].length);pairedReceipt=message;receipts.push(message);
   }else if(message.kind==='result'||message.kind==='submitted'){
    assert.ok(pairedReceipt,'missing paired receipt');assert.equal(pairedReceipt.feedbackSHA256,digest(raw));assert.equal(pairedReceipt.feedbackBytes,raw.length);assert.equal(message.kind,feedbackCount===0?'result':'submitted');if(feedbackCount===0)assert.equal(message.sequence,1);
    record(`actor-visible-feedback-${feedbackCount+1}.jsonl`,raw);feedbackCount++;pairedReceipt=undefined;
    if(feedbackCount===1)setImmediate(()=>sendAction(1));else setImmediate(()=>child.stdin.end());
   }else assert.equal(message.kind,'ready');
  }}catch(error){handlerError??=error;child.stdin.end();}
 });
 // The known local readiness artifact acknowledges the supervisor's write, not actor consumption.
 const readyPoll=setInterval(()=>{if(sent||handlerError||!fs.existsSync(path.join(cellDir,'supervisor-ready.json')))return;sent=true;try{child.stdin.write(prepare());}catch(error){handlerError??=error;child.stdin.end();}},10);
 let exit;try{exit=await exited;}finally{clearTimeout(watchdog);clearInterval(readyPoll);}
 fs.writeFileSync(path.join(base,'test-process-result.json'),JSON.stringify({exit,watchdogExpired,handlerError:handlerError?.message,command,nativeActorDispatched:false})+'\n');
 assert.equal(watchdogExpired,false,'test watchdog fired; retained failure is not successful cleanup');assert.ifError(handlerError);assert.ok(sent);assert.ok(ack);assert.equal(ack.actorId,actorId);assert.equal(ack.assignmentSHA256,assignmentSHA256);assert.equal(pending.length,0);assert.equal(pairedReceipt,undefined);assert.equal(feedbackCount,2);
 const intent=JSON.parse(fs.readFileSync(path.join(cellDir,'actor-dispatch-intent.json'))),result=JSON.parse(fs.readFileSync(path.join(cellDir,'supervisor-result.json')));
 assert.equal(intent.readiness.clockScope,'same supervisor process');assert.equal(digest(fs.readFileSync(path.join(cellDir,'actor-dispatch-intent.json'))),ack.intentSHA256);
 assert.equal(result.status,'submitted',JSON.stringify({result,stderr}));assert.equal(result.cleanup,'closed');assert.equal(result.coordinatorControls,1);assert.equal(result.bootstrap.outputBytes,fs.readFileSync(path.join(base,'bootstrap-output.log')).length);assert.equal(result.bytesOut,result.outcome.confirmedOutputBytes);assert.equal(result.bytesIn,intended.reduce((n,b)=>n+b.length,0));
 assert.equal(result.actionReceipts.receivedCount,2);assert.equal(result.actionReceipts.acknowledgedCount,2);assert.equal(result.coordinatorActionReceiptBytes,result.actionReceipts.receiptOutputBytes);assert.equal(validateActionReceiptEvidence({cellDir,supervision:result}).count,2);
 for(let i=0;i<2;i++){assert.deepEqual(fs.readFileSync(path.join(cellDir,`action-receipts/${String(i+1).padStart(6,'0')}.input.jsonl`)),intended[i]);assert.deepEqual(fs.readFileSync(path.join(cellDir,`action-receipts/${String(i+1).padStart(6,'0')}.feedback.jsonl`)),fs.readFileSync(path.join(base,`actor-visible-feedback-${i+1}.jsonl`)));}
 const events=result.timing.observations,ordered=['worker-spawn','ready-delivered','coordinator-control-start','coordinator-control-ack','bootstrap-emission-verified','actor-input-start','action-received','action-receipt-ack','worker-exit','supervisor-close'];let previous=-1;
 for(const type of ordered){const index=events.findIndex(e=>e.type===type);assert.ok(index>previous,`missing/out-of-order ${type}`);if(previous>=0)assert.ok(events[index].monotonicMs>=events[previous].monotonicMs);previous=index;}
 assert.equal(events.filter(e=>e.type==='action-receipt-ack').length,2);assert.ok(intent.monotonicMs>=events.find(e=>e.type==='coordinator-control-start').monotonicMs);assert.ok(intent.monotonicMs<=events.find(e=>e.type==='coordinator-control-ack').monotonicMs);
 const admission=JSON.parse(fs.readFileSync(path.join(cellDir,'admission.json')));for(const file of ['readiness.mjs','handoff.mjs','bootstrap.mjs','action-receipts.mjs','action-receipt-files.mjs'])assert.equal(admission.bindings['scripts/native-interactive/'+file],digest(fs.readFileSync(path.join(import.meta.dirname,file))));
 const manifest=JSON.parse(fs.readFileSync(path.join(cellDir,'public-handoff.json')));t.diagnostic(JSON.stringify({arm,templateBytes:manifest.template.bytes,readyFrameBytes:manifest.readyFrame.bytes,payloadBytes:manifest.payload.bytes,bootstrapOutputBytes:result.bootstrap.outputBytes,receipts,receiptBytes:result.coordinatorActionReceiptBytes}));
 assert.equal(exit.code,1);assert.equal(exit.signal,null);assert.match(stderr,/actor-dispatch-receipt\.json/);assert.equal(fs.existsSync(path.join(cellDir,'actor-dispatch-receipt.json')),false);assert.equal(fs.existsSync(path.join(cellDir,'submission-result.json')),false);assert.equal(fs.existsSync(path.join(cellDir,'grade.json')),false);
});


test('raw ready capture precedes delivery and preserves Unicode, newline and trailing output',async()=>{
 const raw=Buffer.from(JSON.stringify({kind:'ready',packet:{task:'雪é'}})+'\n'),tail=Buffer.from('{"kind":"result"}\n'),calls=[],emitted=[];
 const forward=createReadyFrameForwarder({persist:bytes=>{calls.push('persist');assert.deepEqual(bytes,raw);},emit:bytes=>{calls.push('emit');emitted.push(Buffer.from(bytes));},onReady:bytes=>{calls.push('ready');assert.deepEqual(bytes,raw);}});
 const split=raw.indexOf(Buffer.from('雪'))+1;await forward(raw.subarray(0,split));assert.deepEqual(calls,[]);await forward(Buffer.concat([raw.subarray(split),tail]));assert.deepEqual(calls,['persist','emit','ready','emit']);assert.deepEqual(Buffer.concat(emitted),Buffer.concat([raw,tail]));
});
test('raw ready delivery failure leaves durable frame and cannot be retried',async()=>{
 const raw=Buffer.from('{"kind":"ready","packet":{}}\n');let persisted=0,ack=0;
 const forward=createReadyFrameForwarder({persist(){persisted++;},emit(){throw Error('transport');},onReady(){ack++;}});await assert.rejects(forward(raw),/transport/);await assert.rejects(forward(raw),/failed/);assert.equal(persisted,1);assert.equal(ack,0);
});
