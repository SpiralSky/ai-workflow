import {completionTransportSourceBindings} from './native-completion-transport.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {PassThrough,Readable} from 'node:stream';
import {NATIVE_LIMITS_MANIFEST} from './completion-lane.mjs';
import {supervise} from './cli.mjs';
import {digest,LIMITS} from './protocol.mjs';
import {checkRuntimePolicy} from './check-runtime.mjs';
import {publicHandoffPolicy,prepareCellPublicHandoff,verifyCellPublicHandoff} from './handoff-files.mjs';
import {runPublicBootstrap} from './bootstrap.mjs';
import {captureActorData} from './actor-data.mjs';
import {captureThroughFixedHelpers as capture,awaitFixedHelperRelay} from './completion-helper-test-support.mjs';
import {verifyCellNativeCompletionEvidence,snapshotSubmission} from './coordinator.mjs';
const evidenceRoot=process.env.AIW_LANE_EVIDENCE??path.resolve(import.meta.dirname,'../../../native-bridge-test-evidence/lane');
const venv=fs.realpathSync(path.resolve(import.meta.dirname,'../../packages/tools/.venv'));
const encode=value=>Buffer.from(JSON.stringify(value)+'\n');
const tick=()=>new Promise(r=>setImmediate(r));
/** Public synthetic bytes through the existing finite supervisor, not a native actor or new runner. */
function fixture(arm){const base=fs.mkdtempSync(path.join(evidenceRoot,'supervisor-')),cellDir=path.join(base,'cell'),root=path.join(cellDir,'workspace');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'a.py'),'value = 1\n');const config={arm,root,allowedWritePaths:['a.py'],venv,cellDir,journalDir:path.join(cellDir,'journal')};const put=(name,value)=>fs.writeFileSync(path.join(cellDir,name),encode(value));const task='Synthetic public deterministic do/read/resolve transport control. No actor.\n';const bindings=completionTransportSourceBindings();const campaign={evidenceMode:'synthetic-control',cells:[{id:'cell',fixtureId:'synthetic',arm}],bindings,limits:LIMITS,publicHandoffPolicy:publicHandoffPolicy()};fs.writeFileSync(path.join(base,'campaign.json'),encode(campaign));put('config.json',config);put('admission.json',{testOnly:true,evidenceMode:'synthetic-control',config,arm,fixtureId:'synthetic',bindings,publicHandoffPolicy:publicHandoffPolicy(),checkRuntimePolicy:checkRuntimePolicy(),nativeCompletionLimits:NATIVE_LIMITS_MANIFEST,taskSHA256:digest(task)});put('assignment.json',{actorId:'synthetic-no-actor',index:0,campaignSHA256:digest(fs.readFileSync(path.join(base,'campaign.json')))});fs.writeFileSync(path.join(cellDir,'TASK.md'),task);return {base,cellDir,config,put};}
for(const {arm,fault} of [{arm:'orchestrate-off'},{arm:'orchestrate-on'},...['response-collision','event-collision','wrong-capability','replay','original-deadline','assignment-deadline','missing-fatal-notice'].map(fault=>({arm:'orchestrate-off',fault}))])test(`fixed FD3 ${fault??'roundtrip'} inside pending do (${arm})`,{timeout:60000},async()=>{
 const f=fixture(arm),input=new PassThrough();input.on('error',()=>{});let elapsed=0;const frames=[];let stderr='',handler=Promise.resolve(),handlerError;const waiters=[];
 const waitFor=predicate=>new Promise(resolve=>{const existing=frames.find(predicate);if(existing)return resolve(existing);waiters.push({predicate,resolve});});
 const acceptFrame=frame=>{frames.push(frame);for(const w of waiters)if(w.predicate(frame))w.resolve(frame);if(frame.version==='native-completion-request-v1')handler=handler.then(async()=>{
  assert.equal(fs.existsSync(path.join(f.cellDir,'action-receipts/000001.ack.json')),false,'do must still be pending');
  if(fault==='missing-fatal-notice'){const ready=JSON.parse(fs.readFileSync(path.join(f.cellDir,'supervisor-ready.json')));const {readLinuxProcessIdentity,identityKey}=await import('./readiness.mjs');assert.equal(identityKey(readLinuxProcessIdentity(ready.processes.worker.pid)),identityKey(ready.processes.worker));process.kill(ready.processes.worker.pid,'SIGKILL');return;}
  let message;
  if(!frame.request.tools.length)message={role:'assistant',content:'["readFile"]'};
  else if(!frame.request.messages.some(m=>m.role==='tool'))message={role:'assistant',content:null,tool_calls:[{id:'read-call',type:'function',function:{name:'branch',arguments:JSON.stringify({code:'async (tools) => await tools.readFile({path:"a.py"})'})}}]};
  else message={role:'assistant',content:'Read @s1.c1. Literal $(touch /tmp/AIW_LANE_NEVER) ; `echo hostile` 🦊'};
  const {request,...envelope}=frame;const raw=encode({...envelope,version:'native-completion-response-v1',message});await capture(f,frame.completionSequence,raw);
  if(fault==='response-collision')fs.writeFileSync(path.join(f.cellDir,'native-completion-000001.response.jsonl'),'retained synthetic collision');
  if(fault==='event-collision'){const next=fs.readdirSync(f.cellDir).filter(n=>/^native-event-\d{6}\.jsonl$/.test(n)).length+1;fs.writeFileSync(path.join(f.cellDir,'native-event-'+String(next).padStart(6,'0')+'.jsonl'),'retained synthetic collision');}
  if(fault==='original-deadline')elapsed=LIMITS.actionMs;
  if(fault==='assignment-deadline')elapsed=LIMITS.assignmentMs;
  await tick();if(fault==='wrong-capability'){const invalid=JSON.parse(raw);invalid.capability='0'.repeat(64);input.write(encode(invalid));}else input.write(raw);
  if(fault==='replay'){await tick();input.write(raw);}if(!fault)await awaitFixedHelperRelay(f,frame.completionSequence);

 }).catch(error=>{handlerError=error;input.destroy(error);});};
 const running=supervise(f.config,{...(['original-deadline','assignment-deadline'].includes(fault)?{clock:{now:()=>elapsed,setTimeout,clearTimeout}}:{}),input,stdout(raw){fs.appendFileSync(path.join(f.base,'stdout.jsonl'),raw);for(const line of String(raw).trim().split('\n'))acceptFrame(JSON.parse(line));},stderr:raw=>stderr+=raw,recordDispatchIntent(options){f.put('actor-dispatch-intent.json',{testOnly:true,phase:'synthetic-control-intent',...options,handoff:verifyCellPublicHandoff({cellDir:f.cellDir})});}});
 const wait=predicate=>Promise.race([waitFor(predicate),running.then(result=>{throw Error('premature supervisor end '+JSON.stringify({result,stderr,handlerError:String(handlerError)}));})]);
 const send=async action=>{const raw=encode(action);await captureActorData({cellDir:f.cellDir,arm,sequence:action.sequence,input:Readable.from([raw]),emit:async b=>({bytes:b.length,sha256:digest(b)})});input.write(raw);};
 try{
  await wait(x=>x.kind==='ready');await tick();const handoff=prepareCellPublicHandoff({cellDir:f.cellDir});input.write(encode({kind:'coordinator-dispatch-intent',actorId:'synthetic-no-actor',assignmentSHA256:digest(fs.readFileSync(path.join(f.cellDir,'assignment.json'))),handoffSHA256:handoff.handoffSHA256,capabilitySHA256:handoff.capabilitySHA256}));await wait(x=>x.kind==='coordinator-dispatch-intent-ack');await tick();await runPublicBootstrap({capabilityPath:handoff.capabilityPath,expectedCapabilitySHA256:handoff.capabilitySHA256,emit:async b=>({bytes:b.length,sha256:digest(b)})});
  if(fault==='assignment-deadline')elapsed=LIMITS.assignmentMs-10000;
  await send({kind:'do',sequence:1,args:{instruction:'Read a.py and report its value.'}});
  if(fault){const supervision=await running;await handler;if(handlerError)throw handlerError;
   const submit=encode({kind:'submit',sequence:2});await captureActorData({cellDir:f.cellDir,arm,sequence:2,input:Readable.from([submit]),emit:async b=>({bytes:b.length,sha256:digest(b)})});input.write(submit);await tick();
   assert.equal(supervision.status,'incomplete');assert.equal(supervision.completionLane.closed,false);assert.equal(supervision.actionReceipts.pending,1);assert.equal(supervision.actionReceipts.acknowledgedCount,0);assert.equal(frames.some(x=>x.kind==='submitted'),false);assert.throws(()=>snapshotSubmission({cellDir:f.cellDir}),/unclean/);assert.equal(fs.existsSync(path.join(f.cellDir,'submission-result.json')),false);
   if(['response-collision','event-collision'].includes(fault)){const file=fault==='response-collision'?'native-completion-fatal.jsonl':'native-events-fatal.jsonl';const fatal=JSON.parse(fs.readFileSync(path.join(f.cellDir,file)));assert.match(supervision.reason,/EEXIST/);assert.ok(supervision.reason.includes(fatal.reason));}
   if(fault==='original-deadline')assert.match(supervision.reason,/original action deadline/);
   if(fault==='assignment-deadline'){assert.match(supervision.reason,/assignment expired|wall timeout/);assert.equal(supervision.timing.assignmentLimitMs,900000);assert.equal(supervision.timing.elapsedMs,900000);}
   fs.writeFileSync(path.join(f.base,'negative-submit-result.json'),encode({fault,supervision,attemptedSubmit:JSON.parse(submit)}));return;
  }
  const result=await wait(x=>x.kind==='result'&&x.sequence===1);await handler;if(handlerError)throw handlerError;assert.equal(result.result[0].isError,false,JSON.stringify(result));await tick();await send({kind:'resolve',sequence:2,args:{ref:'@s1.c1'}});const resolved=await wait(x=>x.kind==='result'&&x.sequence===2);assert.match(resolved.result[0].text,/value = 1/);await tick();await send({kind:'submit',sequence:3});const supervision=await running;await handler;if(handlerError)throw handlerError;assert.equal(supervision.status,'submitted',JSON.stringify({supervision,stderr}));assert.equal(supervision.completionLane.closed,true);assert.equal(supervision.completionLane.sequence,3);assert.equal(supervision.actionReceipts.acknowledgedCount,3);const admission=JSON.parse(fs.readFileSync(path.join(f.cellDir,'admission.json')));const verified=verifyCellNativeCompletionEvidence({cellDir:f.cellDir,admission,supervision});assert.equal(verified.completion.input,null);assert.equal(verified.event.roles.selection.calls,1);assert.equal(verified.event.roles.secondary.calls,2);assert.equal(fs.existsSync('/tmp/AIW_LANE_NEVER'),false);
  const eventFile=verified.event.files.find(x=>x.kind==='native-event').path;fs.copyFileSync(eventFile,path.join(f.base,'event-before-tamper.jsonl'));fs.appendFileSync(eventFile,'corrupt');fs.copyFileSync(eventFile,path.join(f.base,'event-after-tamper.jsonl'));assert.throws(()=>verifyCellNativeCompletionEvidence({cellDir:f.cellDir,admission,supervision}));assert.throws(()=>snapshotSubmission({cellDir:f.cellDir}));assert.equal(fs.existsSync(path.join(f.cellDir,'submission-result.json')),false);
 }catch(error){fs.writeFileSync(path.join(f.base,'test-failure.txt'),String(error.stack??error));input.destroy(error);throw error;}finally{input.destroy();await running;fs.writeFileSync(path.join(f.base,'stderr.log'),stderr);}
});

for(const arm of ['orchestrate-off','orchestrate-on'])test(`old native limits are refused before supervisor setup (${arm})`,async()=>{
 const f=fixture(arm),file=path.join(f.cellDir,'admission.json'),raw=fs.readFileSync(file),admission=JSON.parse(raw);fs.writeFileSync(path.join(f.base,'admission-original.json'),raw);
 admission.nativeCompletionLimits.action.actionMs=60000;admission.nativeCompletionLimits.completion.requestMs=60000;f.put('admission.json',admission);fs.copyFileSync(file,path.join(f.base,'admission-old-policy.json'));
 await assert.rejects(supervise(f.config),/frozen native limits mismatch/);assert.equal(fs.existsSync(path.join(f.cellDir,'supervisor-start.json')),false);assert.equal(fs.existsSync(path.join(f.cellDir,'check-runtime-preflight.json')),false);
});
