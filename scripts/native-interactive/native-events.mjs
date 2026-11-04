import fs from 'node:fs';
import path from 'node:path';
import {digest} from './protocol.mjs';
import {readBounded} from './files.mjs';
import {encodeNative,parseNativeCompletionFrame,nativeKeys,validateNativeBinding,writeNativeExclusive,nativeFileEvidence} from './native-completion.mjs';
export const NATIVE_EVENT_LIMITS=Object.freeze({eventBytes:98304,events:2048,totalBytes:8388608});
const eventPath=(dir,n)=>path.join(dir,'native-event-'+String(n).padStart(6,'0')+'.jsonl');
/** Validate actual reporter records without permitting provider fields or fabricated usage. */
export function validateNativeReporterEvent(e){
 const common=['v','id','parent','ts','kind'];
 const shapes={job:[['job','attempt','framework','problem','rep'],[]],scope:[['label'],[]],turn:[['model','role','latencyMs','usage','usageStatus','usageReason','completionEvidence'],[]],toolStart:[['name','args'],['harnessId']],tool:[['name','args','ok','durationMs','startTs','resultBytes'],['error','harnessId']],attach:[['key'],['data','blob']],end:[['outcome'],['reason']]};
 if(!e||typeof e!=='object'||!Object.hasOwn(shapes,e.kind))throw Error('native reporter kind');const [required,optional]=shapes[e.kind];nativeKeys(e,[...common,...required],optional);
 if(e.v!==1||typeof e.id!=='string'||!e.id||!(e.parent===null||typeof e.parent==='string')||!Number.isFinite(e.ts))throw Error('native reporter common fields');
 const strings={job:['job','framework','problem'],scope:['label'],turn:['model','role'],toolStart:['name'],tool:['name'],attach:['key'],end:['outcome']};for(const key of strings[e.kind])if(typeof e[key]!=='string')throw Error('native reporter string field');for(const key of ['harnessId','error','blob','reason'])if(e[key]!==undefined&&typeof e[key]!=='string')throw Error('native reporter optional field');
 const numbers={job:['attempt','rep'],turn:['latencyMs'],tool:['durationMs','startTs','resultBytes']};for(const key of numbers[e.kind]??[])if(!Number.isFinite(e[key])||e[key]<0)throw Error('native reporter numeric field');if(e.kind==='tool'&&typeof e.ok!=='boolean')throw Error('native reporter tool outcome');
 if(e.kind==='turn'){if(e.usage!==null||e.usageStatus!=='unavailable'||e.usageReason!=='native-harness-unreported'||!['selection','secondary'].includes(e.role))throw Error('native reporter usage');nativeKeys(e.completionEvidence,['completionId','requestSHA256','responseSHA256']);if(typeof e.completionEvidence.completionId!=='string'||!e.completionEvidence.completionId||! /^[a-f0-9]{64}$/.test(e.completionEvidence.requestSHA256)||! /^[a-f0-9]{64}$/.test(e.completionEvidence.responseSHA256))throw Error('native reporter completion identity');}
 return e;
}
/** Reconstruct exact ordered events and join native turns to trusted completion receipts. */
export function verifyNativeEventEvidence({cellDir,binding,completionEvidence,requireComplete=true}){
 binding=validateNativeBinding(binding);if(fs.realpathSync(cellDir)!==cellDir)throw Error('native event cell path');if(fs.existsSync(path.join(cellDir,'native-events-fatal.jsonl')))throw Error('native event fatal evidence');
 const files=[],ids=new Set(),roles={selection:{calls:0,input:null,output:null},secondary:{calls:0,input:null,output:null}},accepted=new Map((completionEvidence?.accepted??[]).map(e=>[e.completionId,e]));let totalBytes=0;
 const recognized=new Set(['native-events-summary.jsonl','native-events-fatal.jsonl']);for(let n=1;n<=NATIVE_EVENT_LIMITS.events;n++)recognized.add(path.basename(eventPath(cellDir,n)));for(const name of fs.readdirSync(cellDir))if(name.startsWith('native-event')&&!recognized.has(name))throw Error('unrecognized native event evidence');
 const names=fs.readdirSync(cellDir).filter(n=>/^native-event-\d+\.jsonl$/.test(n)).sort();if(names.length>NATIVE_EVENT_LIMITS.events)throw Error('native event count');
 for(let i=0;i<names.length;i++){const file=eventPath(cellDir,i+1);if(path.basename(file)!==names[i])throw Error('native event sequence');const raw=readBounded(file,NATIVE_EVENT_LIMITS.eventBytes);totalBytes+=raw.length;if(totalBytes>NATIVE_EVENT_LIMITS.totalBytes)throw Error('native event aggregate');const frame=parseNativeCompletionFrame(raw);nativeKeys(frame,['version','binding','sequence','event']);if(frame.version!=='native-orchestrate-event-v1'||frame.sequence!==i+1||JSON.stringify(frame.binding)!==JSON.stringify(binding))throw Error('native event binding');const e=validateNativeReporterEvent(frame.event);
 if(e.kind==='turn'){if(e.usage!==null||e.usageStatus!=='unavailable'||e.usageReason!=='native-harness-unreported'||!Object.hasOwn(roles,e.role)||['costUsd','cacheHit','classifierEstimate','deepseekEstimate'].some(k=>Object.hasOwn(e,k)))throw Error('native turn usage/role');const ev=e.completionEvidence;nativeKeys(ev,['completionId','requestSHA256','responseSHA256']);if(ids.has(ev.completionId)||JSON.stringify(accepted.get(ev.completionId))!==JSON.stringify(ev))throw Error('native turn completion coverage');ids.add(ev.completionId);roles[e.role].calls++;}
 files.push({...nativeFileEvidence(file),kind:'native-event'});
 }
 if(requireComplete&&ids.size!==accepted.size)throw Error('native missing completion turn');
 const summary={version:'native-orchestrate-evidence-v1',binding,eventCount:names.length,totalBytes,eventSHA256:digest(files.map(f=>f.sha256)),completionIds:[...ids],roles,input:null,output:null,costUsd:null,files};
 const final=path.join(cellDir,'native-events-summary.jsonl');if(fs.existsSync(final)){const stored=parseNativeCompletionFrame(readBounded(final,1048576),1048576);if(JSON.stringify(stored)!==JSON.stringify(summary))throw Error('native final event digest');summary.files=[...files,{...nativeFileEvidence(final),kind:'completion-control'}];}else if(requireComplete)throw Error('native missing event close');
 const {files:allFiles,...metadata}=summary;return {...summary,summary:metadata,files:allFiles};
}
/** Mandatory synchronous durable sink. Any serialization/write/sync failure poisons admission. */
export function createNativeEventSink({cellDir,binding,onFatal,completionEvidence}){
 binding=validateNativeBinding(binding);if(typeof onFatal!=='function'||typeof completionEvidence!=='function'||fs.realpathSync(cellDir)!==cellDir)throw Error('native event callbacks/path');let sequence=0,totalBytes=0,failure,closed=false;
 if(fs.readdirSync(cellDir).some(n=>n.startsWith('native-event')))throw Error('native events already exist');
 const fatal=error=>{if(!failure){failure=error;try{writeNativeExclusive(path.join(cellDir,'native-events-fatal.jsonl'),encodeNative({version:'native-events-fatal-v1',binding,reason:error.message}));}catch{}try{onFatal(error);}catch{}}return failure;};
 return {
 write(event){try{if(failure)throw failure;if(closed)throw Error('native events closed');validateNativeReporterEvent(event);const raw=encodeNative({version:'native-orchestrate-event-v1',binding,sequence:sequence+1,event});parseNativeCompletionFrame(raw);if(raw.length>NATIVE_EVENT_LIMITS.eventBytes||sequence+1>NATIVE_EVENT_LIMITS.events||totalBytes+raw.length>NATIVE_EVENT_LIMITS.totalBytes)throw Error('native event limit');writeNativeExclusive(eventPath(cellDir,sequence+1),raw);sequence++;totalBytes+=raw.length;}catch(e){throw fatal(e);}},
 close(){try{if(failure)throw failure;if(closed)throw Error('native events already closed');const evidence=completionEvidence();const verified=verifyNativeEventEvidence({cellDir,binding,completionEvidence:evidence,requireComplete:false});const {summary:metadata,...summary}=verified;if(summary.completionIds.length!==evidence.accepted.length)throw Error('native missing completion turn');writeNativeExclusive(path.join(cellDir,'native-events-summary.jsonl'),encodeNative(summary));closed=true;return verifyNativeEventEvidence({cellDir,binding,completionEvidence:evidence});}catch(e){throw fatal(e);}},
 verifyComplete(){try{if(failure)throw failure;return verifyNativeEventEvidence({cellDir,binding,completionEvidence:completionEvidence()});}catch(e){throw fatal(e);}},
 summary(){if(failure)throw failure;return verifyNativeEventEvidence({cellDir,binding,completionEvidence:completionEvidence()}).summary;},
 get failed(){return !!failure;},get fatalReason(){return failure?.message??null;}
 };
}
