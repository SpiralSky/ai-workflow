import {boundedLines,Ledger,LIMITS,LOCAL_WATCHDOGS,monotonicNow} from './protocol.mjs';

const CLOCK=Object.freeze({now:monotonicNow,setTimeout,clearTimeout});
/** Finite deterministic tool loop, without model transport. The supervisor owns the earlier
 * launch-to-close deadline; these observations cover only this worker's measured lifetime.
 * Clock injection is for deterministic controls, never an actor-selectable budget.
 */
export async function runCell({arm,input,emit,journal,createSession,onSubmit,evidenceMode='synthetic-control',clock=CLOCK}) {
 const ledger=new Ledger(arm),started=clock.now(),deadline=started+LIMITS.assignmentMs;
 let fatalReason;
 const latchFatal=error=>{fatalReason??=String(error);activeAbort?.abort(error);ledger.fail(fatalReason);};
 const assertHealthy=()=>{if(session?.fatalReason)latchFatal(session.fatalReason);if(fatalReason)throw Error(fatalReason);};
 let session,submitted=false,visibleInputBytes=0,visibleFeedbackBytes=0,initialBytes=0,outcome,closePromise,cleanupStatus='pending',confirmedOutputBytes=0;
 let phase='setup',phaseStarted=started,lastObserved=started,recording=true,activeAbort,initializationPending=false,cleanupRequested=false;
 const phasesMs={setup:0,input:0,action:0,emit:0,submit:0,close:0};
 const now=()=>{const value=clock.now();if(!Number.isFinite(value)||value<lastObserved)throw Error('invalid monotonic clock');lastObserved=value;return value;};
 const observation=(type,fields={})=>{const at=now();journal.append({type,monotonicMs:at,observedAtUTC:new Date().toISOString(),...fields});return at;};
 const enter=next=>{const at=now();phasesMs[phase]+=at-phaseStarted;phase=next;phaseStarted=at;};
 /** Reserve an absolute deadline before invoking an effect and reject late fulfilled promises. */
 const bounded=(operation,label,cap=LIMITS.assignmentMs,abort)=>{
  const end=Math.min(deadline,now()+cap);
  return new Promise((resolve,reject)=>{
   let settled=false,timer;
   const finish=(error,value)=>{if(settled)return;settled=true;clock.clearTimeout(timer);if(error)reject(error);else resolve(value);};
   const expire=()=>{const error=Error(`${label} timeout`);finish(error);abort?.abort(error);};
   if(end<=now()){expire();return;}
   timer=clock.setTimeout(expire,end-now());
   Promise.resolve().then(()=>{if(!settled)return operation();}).then(value=>{if(settled)return;try{if(now()>=end)expire();else finish(undefined,value);}catch(error){finish(error);}},error=>finish(error));
  });
 };
 const close=()=>closePromise??=(async()=>{
  cleanupRequested=true;let observationError;
  try{enter('close');observation('close-start');}catch(error){observationError=error;}
  // Always request cooperative cleanup once, even when no wait budget remains.
  const pending=session?Promise.resolve().then(()=>session.close()):Promise.resolve();
  pending.catch(()=>{});
  try{await bounded(()=>pending,'cleanup',LOCAL_WATCHDOGS.cleanupMs);if(initializationPending)throw Error('session initialization unresolved');if(observationError)throw observationError;cleanupStatus='closed';observation('close-end',{status:'closed'});}
  catch(error){cleanupStatus='uncertain';try{observation('close-end',{status:'uncertain',reason:String(error)});}catch{}throw error;}
 })();
 const output=async(value,initial=false)=>{
  enter('emit');const line=JSON.stringify(value)+'\n',bytes=Buffer.byteLength(line);
  if(bytes>LIMITS.lineBytes)throw Error('emitted result too large');
  if(!initial && visibleFeedbackBytes+bytes>LIMITS.feedbackBytes)throw Error('visible feedback limit');
  observation('emission-attempt',{initial,text:line});
  if(initial)initialBytes+=bytes;else visibleFeedbackBytes+=bytes;
  await bounded(()=>emit(line),'emission');confirmedOutputBytes+=bytes;
  observation('emission-ack',{bytes});
 };
 try {
  observation('worker-start');
  session=await bounded(async()=>{initializationPending=true;try{const created=await createSession({
   onFatal:latchFatal,
   onHostAttempt(name,args){ledger.hostAttempt(name,args);observation('host-attempt',{name,args});},
   onHostResult(event){if(recording)observation('host-result',{event});},
  });if(cleanupRequested){Promise.resolve().then(()=>created.close()).catch(()=>{});}else session=created;return created;}finally{initializationPending=false;}},'session initialization');
  assertHealthy();await output({kind:'ready',packet:session.packet},true);observation('ready');
  const lines=boundedLines(input)[Symbol.asyncIterator]();
  while(true) {
   enter('input');const next=await bounded(()=>lines.next(),'assignment');if(next.done)break;
   visibleInputBytes+=Buffer.byteLength(next.value)+1;
   assertHealthy();const action=ledger.reserve(next.value);observation('reserved',{action});
   if(action.kind==='submit') {
    observation('submit-received',{sequence:action.sequence});assertHealthy();await close();assertHealthy();
    enter('submit');const submission=await bounded(()=>onSubmit(),'submission');
    assertHealthy();ledger.finish({kind:'submitted',submission},true);observation('result',{result:{kind:'submitted',submission}});
    await output({kind:'submitted',submission});submitted=true;break;
   }
   enter('action');activeAbort=new AbortController();observation('action-start',{sequence:action.sequence});
   let result;
   try{result=await bounded(()=>{assertHealthy();return session.dispatch(action,activeAbort.signal);},'action',LIMITS.actionMs,activeAbort);assertHealthy();observation('action-end',{sequence:action.sequence,status:'returned'});}
   catch(error){observation('action-end',{sequence:action.sequence,status:'incomplete',reason:String(error)});throw error;}
   finally{activeAbort=undefined;}
   ledger.finish(result);observation('result',{result});await output({kind:'result',sequence:action.sequence,result});
  }
  if(!submitted)throw Error('EOF before submission');
  outcome={status:'submitted'};
 } catch(error) {
  activeAbort?.abort(error);if(fatalReason)error=Error(fatalReason);ledger.fail(String(error));try{observation('failure',{reason:String(error)});}catch{/* preserve the original error */}
  outcome={status:'incomplete',reason:String(error)};
 } finally {
  try{await close();}catch{outcome={status:'incomplete',reason:fatalReason??'cleanup uncertain'};}
  if(fatalReason)outcome={status:'incomplete',reason:fatalReason};
 }
 const ended=now();phasesMs[phase]+=ended-phaseStarted;
 const timing={scope:'worker-local observations; supervisor owns launch-to-close ceiling',startedMonotonicMs:started,endedMonotonicMs:ended,elapsedMs:ended-started,inputWaitMs:phasesMs.input,helperActiveMs:ended-started-phasesMs.input,phasesMs};
 outcome={...outcome,evidenceMode,...(fatalReason?{fatalReason}:{}),visibleInputBytes,visibleFeedbackBytes,initialBytes,hostAttempts:ledger.calls,confirmedOutputBytes,cleanupStatus,timing};
 try{observation('terminal',{outcome});}catch{outcome={...outcome,status:'incomplete',reason:'terminal journal failure'};}
 recording=false;return outcome;
}
