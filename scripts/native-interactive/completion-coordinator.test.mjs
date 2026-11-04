import {encodeFinalSubmissionFrame} from './completion-lane.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {PassThrough,Readable} from 'node:stream';
import {supervise} from './cli.mjs';
import {digest,LIMITS} from './protocol.mjs';
import {nativeCompletionPaths} from './native-completion.mjs';
import {completionTransportPaths} from './native-completion-transport.mjs';
import {SCREENING_MODE} from './cooperative-screening.mjs';
import {publicCanaryRegistry,canaryRegistryBytes} from './screening-audit.mjs';
import {checkRuntimePolicy,inspectCheckRuntime} from './check-runtime.mjs';
import {publicHandoffPolicy,prepareCellPublicHandoff,verifyCellPublicHandoff} from './handoff-files.mjs';
import {runPublicBootstrap} from './bootstrap.mjs';
import {captureActorData} from './actor-data.mjs';
import {captureThroughFixedHelpers as capture,awaitFixedHelperRelay} from './completion-helper-test-support.mjs';
import {freezeCampaign,admitNext,preparePublicHandoff,recordActorDispatchReceipt,inspectCellScreeningAudit,verifyCellNativeCompletionEvidence,snapshotSubmission} from './coordinator.mjs';
const evidenceRoot=process.env.AIW_LANE_EVIDENCE??path.resolve(import.meta.dirname,'../../../native-bridge-test-evidence/lane');
const venv=fs.realpathSync(path.resolve(import.meta.dirname,'../../packages/tools/.venv'));
const encode=value=>Buffer.from(JSON.stringify(value)+'\n');
const tick=()=>new Promise(r=>setImmediate(r));
/** Persist the exact negative observation outside the cell before restoring any test bytes. */
function expectRejection(f,label,target,operation,family){
 let caught;try{operation();}catch(error){caught=error;}
 fs.writeFileSync(path.join(f.base,'expected-negative-'+label+'.json'),encode({scope:'synthetic expected-negative observation',label,target,expectedFamily:family.source,error:caught?{name:caught.name,message:caught.message,code:caught.code??null,path:caught.path??null}:null}));
 assert.ok(caught,'expected rejection: '+label);assert.match(caught.message,family);return caught;
}
/** Public synthetic bytes through the existing finite supervisor, not a native actor or new runner. */
function fixture(arm){
 const base=fs.mkdtempSync(path.join(evidenceRoot,'coordinator-')),campaignDir=path.join(base,'campaign');
 fs.writeFileSync(path.join(base,'control-kind.json'),encode({testOnly:true,kind:'actual-coordinator-source-gates-in-existing-synthetic-control-mode',nativeActorDispatched:false,providerRequests:0,gradeInvoked:false}));
 const registry=publicCanaryRegistry({version:1,campaignId:'synthetic-native-coordinator',entries:[{artifactId:'grader',role:'grader',cellId:null,marker:'AIW_CANARY_'+'0'.repeat(32),authorizedScopes:[{role:'coordinator',phase:'grade',cellId:null}]},{artifactId:'output-cell',role:'run-output',cellId:'cell',marker:'AIW_CANARY_'+'1'.repeat(32),authorizedScopes:[{role:'coordinator',phase:'audit',cellId:'cell'}]}]});
 const privatePaths=['experiments/native-dev/grade.py','.specplane/native-reconstruction-inventory.json','.specplane/native-offline-check-inventory.json'];const absence=privatePaths.map(p=>({path:p,present:fs.existsSync(path.resolve(import.meta.dirname,'../..',p))}));assert.ok(absence.every(x=>!x.present));fs.writeFileSync(path.join(base,'public-only-absence.json'),encode(absence));const runtime=inspectCheckRuntime(venv,base);fs.writeFileSync(path.join(base,'runtime-closure.json'),encode(runtime));
 const privateAbsenceSHA256=digest(encode(absence)),controls={version:1,canaryRegistrySHA256:digest(canaryRegistryBytes(registry)),privateAbsenceSHA256,runtimeClosureSHA256:digest(encode(runtime)),auditCoverage:'relay-and-observed-native-tools-only',coordinatorTarget:'/root/synthetic_coordinator'};
 freezeCampaign({campaignDir,cells:[{id:'cell',fixtureId:'csv-contact-import',arm}],evidenceMode:'synthetic-control',admissionMode:SCREENING_MODE,screeningControls:controls});fs.writeFileSync(path.join(campaignDir,'canary-registry.json'),canaryRegistryBytes(registry));
 const config=admitNext({campaignDir,index:0,venv,actorId:'synthetic-no-actor',privateAbsenceSHA256}),cellDir=config.cellDir;
 const put=(name,value)=>fs.writeFileSync(path.join(cellDir,name),encode(value));
 return {base,cellDir,config,put};
}
for(const {arm,canary,empty} of [{arm:'orchestrate-off',canary:false},{arm:'orchestrate-on',canary:false},{arm:'orchestrate-off',canary:true},{arm:'orchestrate-off',canary:false,empty:true}])test(`actual coordinator admits, snapshots and audits synthetic FD3 control (${arm}, canary=${canary}, empty=${empty??false})`,{timeout:60000},async()=>{
 const f=fixture(arm),input=new PassThrough();input.on('error',()=>{});const frames=[];let stderr='',handler=Promise.resolve(),handlerError;const waiters=[];
 const waitFor=predicate=>new Promise(resolve=>{const existing=frames.find(predicate);if(existing)return resolve(existing);waiters.push({predicate,resolve});});
 const acceptFrame=frame=>{frames.push(frame);for(const w of waiters)if(w.predicate(frame))w.resolve(frame);if(frame.version==='native-completion-request-v1')handler=handler.then(async()=>{
  assert.equal(fs.existsSync(path.join(f.cellDir,'action-receipts/000001.ack.json')),false,'do must still be pending');
  let message;
  if(!frame.request.tools.length)message={role:'assistant',content:'["readFile"]'};
  else if(!frame.request.messages.some(m=>m.role==='tool'))message={role:'assistant',content:null,tool_calls:[{id:'read-call',type:'function',function:{name:'branch',arguments:JSON.stringify({code:'async (tools) => await tools.readFile({path:"importer.py"})'})}}]};
  else message={role:'assistant',content:'Read @s1.c1. Literal $(touch /tmp/AIW_LANE_NEVER) ; `echo hostile` 🦊'+(canary?' AIW_CANARY_'+'0'.repeat(32):'')};
  const {request,...envelope}=frame;const raw=encode({...envelope,version:'native-completion-response-v1',message});await capture(f,frame.completionSequence,raw);await tick();input.write(raw);await awaitFixedHelperRelay(f,frame.completionSequence);
 }).catch(error=>{handlerError=error;input.destroy(error);});};
 const running=supervise(f.config,{input,stdout(raw){fs.appendFileSync(path.join(f.base,'stdout.jsonl'),raw);for(const line of String(raw).trim().split('\n'))acceptFrame(JSON.parse(line));},stderr:raw=>stderr+=raw});
 const wait=predicate=>Promise.race([waitFor(predicate),running.then(result=>{throw Error('premature supervisor end '+JSON.stringify({result,stderr,handlerError:String(handlerError)}));})]);
 const send=async action=>{const raw=encode(action);await captureActorData({cellDir:f.cellDir,arm,sequence:action.sequence,input:Readable.from([raw]),emit:async b=>({bytes:b.length,sha256:digest(b)})});input.write(raw);};
 try{
  await wait(x=>x.kind==='ready');await tick();const handoff=preparePublicHandoff({cellDir:f.cellDir});input.write(encode({kind:'coordinator-dispatch-intent',actorId:'synthetic-no-actor',assignmentSHA256:digest(fs.readFileSync(path.join(f.cellDir,'assignment.json'))),handoffSHA256:handoff.handoffSHA256,capabilitySHA256:handoff.capabilitySHA256}));await wait(x=>x.kind==='coordinator-dispatch-intent-ack');await tick();assert.throws(()=>recordActorDispatchReceipt({cellDir:f.cellDir,actorId:'synthetic-no-actor',nativeTaskId:'forbidden',receiptReference:'forbidden'}),/synthetic control forbids/);assert.equal(fs.existsSync(path.join(f.cellDir,'actor-dispatch-receipt.json')),false);await runPublicBootstrap({capabilityPath:handoff.capabilityPath,expectedCapabilitySHA256:handoff.capabilitySHA256,emit:async b=>({bytes:b.length,sha256:digest(b)})});
  if(empty){await send({kind:'submit',sequence:1});const supervision=await running;assert.equal(supervision.status,'submitted',JSON.stringify({supervision,stderr}));assert.equal(supervision.completionLane.closeEvidence.completion.attempts,0);assert.equal(supervision.completionLane.closeEvidence.event.eventCount,0);expectRejection(f,'empty-native-snapshot',path.join(f.cellDir,'native-events-summary.jsonl'),()=>snapshotSubmission({cellDir:f.cellDir}),/^empty native evidence cannot support snapshot or comparison$/);assert.equal(fs.existsSync(path.join(f.cellDir,'submission-result.json')),false);fs.writeFileSync(path.join(f.base,'empty-native-snapshot-rejected.json'),encode({evidenceMode:'synthetic-control',supervision,snapshotAccepted:false}));return;}
  await send({kind:'do',sequence:1,args:{instruction:'Read importer.py and report its contents.'}});const result=await wait(x=>x.kind==='result'&&x.sequence===1);await handler;if(handlerError)throw handlerError;assert.equal(result.result[0].isError,false,JSON.stringify(result));await tick();await send({kind:'resolve',sequence:2,args:{ref:'@s1.c1'}});const resolved=await wait(x=>x.kind==='result'&&x.sequence===2);assert.match(resolved.result[0].text,/import/);await tick();await send({kind:'submit',sequence:3});const supervision=await running;await handler;if(handlerError)throw handlerError;assert.equal(supervision.status,'submitted',JSON.stringify({supervision,stderr}));assert.equal(supervision.completionLane.closed,true);assert.equal(supervision.completionLane.sequence,3);assert.equal(supervision.actionReceipts.acknowledgedCount,3);const admission=JSON.parse(fs.readFileSync(path.join(f.cellDir,'admission.json')));const verified=verifyCellNativeCompletionEvidence({cellDir:f.cellDir,admission,supervision});assert.equal(verified.completion.input,null);assert.equal(verified.event.roles.selection.calls,1);assert.equal(verified.event.roles.secondary.calls,2);assert.equal(fs.existsSync('/tmp/AIW_LANE_NEVER'),false);
  for(const [index,file] of [verified.completion.files.find(x=>x.kind==='completion-response'),verified.event.files.find(x=>x.kind==='native-event')].entries()){
   const retained=path.join(f.base,'missing-original-'+index+'.jsonl');fs.renameSync(file.path,retained);expectRejection(f,'missing-source-'+index,file.path,()=>snapshotSubmission({cellDir:f.cellDir}),index===0?/ENOENT/:/^native event sequence$/);assert.equal(fs.existsSync(path.join(f.cellDir,'submission-result.json')),false);fs.renameSync(retained,file.path);fs.copyFileSync(file.path,retained);
  }
  const snapshot=snapshotSubmission({cellDir:f.cellDir});assert.equal(snapshot.status,'review_required');assert.equal(snapshot.evidenceMode,'synthetic-control');assert.equal(snapshot.dispatch,null);assert.equal(supervision.evidenceMode,'synthetic-control');assert.equal(supervision.outcome.evidenceMode,'synthetic-control');assert.equal(snapshot.fullTaskSuccess,null);
  const terminalFrame=encodeFinalSubmissionFrame(snapshot,supervision);fs.writeFileSync(path.join(f.base,'final-submission-encoder.jsonl'),terminalFrame);fs.writeFileSync(path.join(f.base,'final-submission-encoder-observation.json'),encode({scope:'production encoder output; not observed CLI delivery',bytes:terminalFrame.length,sha256:digest(terminalFrame),evidenceMode:'synthetic-control'}));
  f.put('audit-observations.json',{version:1,nativeToolLogCoverage:'unavailable',subprocessReadCoverage:'unobserved',accessFindings:[]});
  const audit=inspectCellScreeningAudit({cellDir:f.cellDir});assert.equal(audit.comparisonEligible,!canary);if(canary){assert.equal(audit.assessment,'contamination-detected');assert.ok(audit.hits.some(h=>h.sourceId==='native/completion-response'&&h.classification==='unauthorized'));}for(const kind of ['completion-request','completion-response','completion-control','native-event'])assert.ok(audit.sources.some(s=>s.kind===kind&&s.status==='complete'));f.put('audit.json',audit);
  // Select each intended layer explicitly: evidence ordering is not an artifact identity.
  const responseFile=nativeCompletionPaths(f.cellDir,1)['capture-input'];
  assert.ok(verified.completion.files.some(x=>x.kind==='completion-response'&&x.path===responseFile),'original capture input must be included in verified evidence');
  const original=fs.readFileSync(responseFile);fs.writeFileSync(path.join(f.base,'response-before-tamper.jsonl'),original);fs.appendFileSync(responseFile,'tamper');fs.copyFileSync(responseFile,path.join(f.base,'response-after-tamper.jsonl'));expectRejection(f,'tampered-completion-audit',responseFile,()=>inspectCellScreeningAudit({cellDir:f.cellDir}),/^transport wrapper input receipt$/);fs.writeFileSync(responseFile,original);
  const readerFile=completionTransportPaths(f.cellDir,1)['reader-output'];
  assert.ok(verified.completion.files.some(x=>x.kind==='completion-response'&&x.path===readerFile),'transport reader output must be included in verified evidence');
  const readerOriginal=fs.readFileSync(readerFile);fs.writeFileSync(path.join(f.base,'reader-before-tamper.jsonl'),readerOriginal);fs.appendFileSync(readerFile,'tamper');fs.copyFileSync(readerFile,path.join(f.base,'reader-after-tamper.jsonl'));expectRejection(f,'tampered-reader-audit',readerFile,()=>inspectCellScreeningAudit({cellDir:f.cellDir}),/^transport reader drift$/);fs.writeFileSync(readerFile,readerOriginal);
  const eventFile=verified.event.files.find(x=>x.kind==='native-event').path,eventOriginal=fs.readFileSync(eventFile);fs.writeFileSync(path.join(f.base,'event-before-tamper.jsonl'),eventOriginal);fs.appendFileSync(eventFile,'corrupt');fs.copyFileSync(eventFile,path.join(f.base,'event-after-tamper.jsonl'));expectRejection(f,'tampered-event-audit',eventFile,()=>inspectCellScreeningAudit({cellDir:f.cellDir}),/^invalid native frame$/);expectRejection(f,'tampered-event-evidence',eventFile,()=>verifyCellNativeCompletionEvidence({cellDir:f.cellDir,admission,supervision}),/^invalid native frame$/);expectRejection(f,'tampered-event-snapshot',eventFile,()=>snapshotSubmission({cellDir:f.cellDir}),/^invalid native frame$/);assert.equal(fs.existsSync(path.join(f.cellDir,'grade.json')),false);
 }catch(error){fs.writeFileSync(path.join(f.base,'test-failure.txt'),String(error.stack??error));input.destroy(error);throw error;}finally{input.destroy();await running;fs.writeFileSync(path.join(f.base,'stderr.log'),stderr);}
});
