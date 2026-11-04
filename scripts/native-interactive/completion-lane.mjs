import {FIXED_COMPLETION_TRANSPORT_LIMITS} from './native-completion-transport.mjs';
import {NATIVE_COMPLETION_BOOTSTRAP_LIMITS} from './native-completion-bootstrap.mjs';
import {randomBytes} from 'node:crypto';
import {digest,monotonicNow,LIMITS} from './protocol.mjs';
import {NATIVE_COMPLETION_LIMITS,NATIVE_COMPLETION_CLOCK_POLICY,parseNativeCompletionFrame,nativeKeys,encodeNative,validateNativeCompletionResponse,verifyNativeCompletionEvidence} from './native-completion.mjs';
import {verifyNativeEventEvidence,NATIVE_EVENT_LIMITS} from './native-events.mjs';
import {verifyDeliveredNativeCompletion,NATIVE_COMPLETION_CAPTURE_LIMITS} from './native-completion-capture.mjs';

export const COMPLETION_TRANSPORT_LIMITS=Object.freeze({frameBytes:98304,laneBytes:1048576,inputBytes:3145728,outputBytes:3145728,terminalReserveBytes:98304});
export const NATIVE_LIMITS_MANIFEST=Object.freeze({action:LIMITS,completion:NATIVE_COMPLETION_LIMITS,event:NATIVE_EVENT_LIMITS,transport:COMPLETION_TRANSPORT_LIMITS,capture:NATIVE_COMPLETION_CAPTURE_LIMITS,bootstrap:NATIVE_COMPLETION_BOOTSTRAP_LIMITS,clockPolicy:NATIVE_COMPLETION_CLOCK_POLICY,fixedDelivery:FIXED_COMPLETION_TRANSPORT_LIMITS});
/** Owner-derived identity shared by the worker and supervisor; never accepted from actor input. */
export function completionBinding(admission,admissionSHA256,cellId){return Object.freeze({sourceSHA256:digest(admission.bindings),admissionSHA256,cellId,arm:admission.arm,limitsSHA256:digest(NATIVE_LIMITS_MANIFEST)});}
/** Preserve arbitrary UTF-8 chunks, but accept exactly one LF frame per delivery. */
export function createCompletionFramer({maxBytes=COMPLETION_TRANSPORT_LIMITS.frameBytes,totalBytes=COMPLETION_TRANSPORT_LIMITS.laneBytes}={}){
 let pieces=[],bytes=0,total=0,failed=false,retained=Buffer.alloc(0);
 return {push(chunk){if(failed)throw Error('completion framer failed');try{if(!Buffer.isBuffer(chunk))throw Error('completion requires bytes');total+=chunk.length;if(bytes+chunk.length<=maxBytes)retained=Buffer.concat([...pieces,Buffer.from(chunk)]);if(total>totalBytes)throw Error('completion aggregate bytes');const lf=chunk.indexOf(10);if(lf>=0&&lf!==chunk.length-1)throw Error('completion coalesced frames');bytes+=chunk.length;if(bytes>maxBytes)throw Error('completion frame bytes');pieces.push(Buffer.from(chunk));if(lf<0)return null;const raw=Buffer.concat(pieces,bytes);pieces=[];bytes=0;parseNativeCompletionFrame(raw,maxBytes);return raw;}catch(e){failed=true;throw e;}},eof(){if(bytes)throw Error('completion unterminated frame');},get total(){return total;},get pending(){return bytes>0;},get retained(){return Buffer.from(retained);}};
}
/** IPC is a byte stream: trusted control frames may share a chunk without changing meaning. */
export function createCompletionIPCFramer(){
 const frame=createCompletionFramer();
 return {push(chunk){if(!Buffer.isBuffer(chunk))throw Error('completion IPC requires bytes');const complete=[];let start=0;for(let i=0;i<chunk.length;i++)if(chunk[i]===10){const raw=frame.push(chunk.subarray(start,i+1));if(raw)complete.push(raw);start=i+1;}if(start<chunk.length)frame.push(chunk.subarray(start));return complete;},eof:()=>frame.eof(),get total(){return frame.total;},get retained(){return frame.retained;}};
}
/** Independent supervisor authority: the action remains pending until its real feedback. */
export function createSupervisorCompletionLane({cellDir,binding,checkActive,emitWorker,emitExternal,onFatal,now=monotonicNow,verifyCapture=verifyDeliveredNativeCompletion,verifyCompletion=verifyNativeCompletionEvidence,verifyEvents=verifyNativeEventEvidence}){
 let failure,pendingAction,pending,sequence=0,closed=false,closeEvidence,workerIn=0,workerOut=0,externalIn=0,externalOut=0;
 const seen=new Set();
 const fatal=error=>{failure??=String(error);onFatal(failure);return Error(failure);};
 const active=()=>{if(failure)throw Error(failure);checkActive();if(pendingAction&&now()>=pendingAction.deadline)throw Error('original action deadline expired');};
 const count=(key,raw)=>{const size=raw.length;if(size>COMPLETION_TRANSPORT_LIMITS.frameBytes)throw Error('completion frame bytes');if(key==='workerIn')workerIn+=size;if(key==='workerOut')workerOut+=size;if(key==='externalIn')externalIn+=size;if(key==='externalOut')externalOut+=size;if(Math.max(workerIn,workerOut,externalIn,externalOut)>COMPLETION_TRANSPORT_LIMITS.laneBytes)throw Error('completion aggregate bytes');};
 const send=async(target,value)=>{const raw=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value)+'\n');active();count(target==='worker'?'workerOut':'externalOut',raw);await(target==='worker'?emitWorker(raw):emitExternal(raw));active();};
 const same=value=>{if(JSON.stringify(value)!==JSON.stringify(binding))throw Error('completion binding mismatch');};
 const guard=fn=>async(...args)=>{try{return await fn(...args);}catch(e){throw fatal(e);}};
 return {
  beginAction(action){try{active();if(closed||pendingAction||pending)throw Error('completion action overlap');pendingAction={sequence:action.sequence,kind:action.kind,deadline:now()+LIMITS.actionMs};}catch(e){throw fatal(e);}},
  endAction(){try{active();if(pending)throw Error('action feedback before completion response');pendingAction=undefined;}catch(e){throw fatal(e);}},
  worker:guard(async raw=>{
   count('workerIn',raw);active();const frame=parseNativeCompletionFrame(raw);same(frame.binding);
   if(frame.version==='native-completion-fatal-v1'){if(Object.keys(frame).sort().join(',')!=='binding,reason,version'||typeof frame.reason!=='string')throw Error('invalid fatal frame');throw Error(frame.reason);}
   if(closed)throw Error('completion after close');
   if(frame.version==='native-completion-reserve-v1'){
    if(Object.keys(frame).sort().join(',')!=='actionSequence,binding,completionId,completionSequence,deadlineMonotonicMs,requestSHA256,version'||!pendingAction||pendingAction.kind!=='do'||pending||frame.actionSequence!==pendingAction.sequence||frame.completionSequence!==sequence+1||sequence>=32||typeof frame.completionId!=='string'||!frame.completionId||frame.completionId.length>160||seen.has(frame.completionId)||!/^[a-f0-9]{64}$/.test(frame.requestSHA256)||!Number.isFinite(frame.deadlineMonotonicMs))throw Error('invalid completion reservation');
    sequence++;seen.add(frame.completionId);pending={reservation:frame,capability:randomBytes(32).toString('hex'),request:null};
    await send('worker',{version:'native-completion-grant-v1',completionId:frame.completionId,capability:pending.capability});return;
   }
   if(frame.version==='native-completion-request-v1'){
    if(!pending||pending.request)throw Error('completion request without reservation');nativeKeys(frame,['version','binding','actionSequence','completionSequence','completionId','requestSHA256','deadlineMonotonicMs','capability','request']);const {request,capability,...reservation}=frame;nativeKeys(request,['system','messages','tools']);if(digest(encodeNative(request))!==frame.requestSHA256)throw Error('completion payload digest mismatch');
    if(JSON.stringify({...reservation,version:'native-completion-reserve-v1'})!==JSON.stringify(pending.reservation)||capability!==pending.capability)throw Error('completion grant mismatch');
    pending.request=frame;await send('external',raw);return;
   }
   if(frame.version==='native-completion-close-v1'){
    if(Object.keys(frame).sort().join(',')!=='binding,completion,event,version'||pending||pendingAction?.kind!=='submit')throw Error('completion close without idle submit');
    const completion=verifyCompletion({cellDir,binding,requireComplete:true});const event=verifyEvents({cellDir,binding,completionEvidence:completion,requireComplete:true});
    if(JSON.stringify(frame.completion)!==JSON.stringify(completion.summary)||JSON.stringify(frame.event)!==JSON.stringify(event.summary))throw Error('completion close evidence disagreement');
    closeEvidence={completion:completion.summary,event:event.summary};await send('worker',{version:'native-completion-close-ack-v1',binding});closed=true;return;
   }
   throw Error('unexpected completion worker frame');
  }),
  response:guard(async raw=>{count('externalIn',raw);active();if(closed||!pending?.request)throw Error('completion response without request');const frame=parseNativeCompletionFrame(raw);validateNativeCompletionResponse(frame,pending.request);verifyCapture({cellDir,sequence:pending.reservation.completionSequence,raw});active();await send('worker',raw);pending=undefined;}),
  assertComplete(){try{active();if(!closed||pending||pendingAction)throw Error('completion close agreement missing');return closeEvidence;}catch(e){throw fatal(e);}},
  get snapshot(){return {failed:!!failure,fatalReason:failure??null,pending:pending?.reservation.completionId??null,closed,sequence,workerIn,workerOut,externalIn,externalOut,closeEvidence};},
 };
}

/** Encode the actual post-close CLI frame, reserving no uncounted transport capacity. */
export function encodeFinalSubmissionFrame(submission,supervision){
 const raw=Buffer.from(JSON.stringify({kind:'final-submission',submission})+'\n');
 if(raw.length>COMPLETION_TRANSPORT_LIMITS.terminalReserveBytes)throw Error('final submission frame too large');
 const prior=supervision.transportOutputBytes;
 if(!Number.isSafeInteger(prior)||prior<0||prior+raw.length>COMPLETION_TRANSPORT_LIMITS.outputBytes)throw Error('final submission combined output limit');
 return raw;
}
