import {ARMS,LIMITS,digest,parseAction} from './protocol.mjs';

export const RECEIPT_LIMITS=Object.freeze({frameBytes:4096,totalBytes:12*4096});
const BINDINGS=['assignmentSHA256','admissionSHA256','configSHA256','supervisorStartSHA256','dispatchIntentSHA256'];

/** Retain at most one bounded LF frame, rejecting a coalesced next action before effects. */
function framer(maxBytes,label) {
 let pieces=[],bytes=0;
 return {
  get pending(){return bytes>0;},
  push(chunk){
   if(!Buffer.isBuffer(chunk))throw Error(`${label} requires Buffer`);
   const lf=chunk.indexOf(10);
   if(lf!==-1 && lf!==chunk.length-1)throw Error(`${label} coalesced extra bytes`);
   if(bytes+chunk.length>maxBytes)throw Error(`${label} frame too large`);
   if(chunk.length){pieces.push(Buffer.from(chunk));bytes+=chunk.length;}
   if(lf===-1)return null;
   const raw=Buffer.concat(pieces,bytes);pieces=[];bytes=0;
   // Hash before decoding; retain BOM, CR and LF without text normalization.
   const SHA256=digest(raw);
   new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
   return {raw,SHA256};
  },
 };
}

/** Observe sequential native action/worker feedback bytes. This is not actor authorship
 * evidence. No timeout is created: checkActive belongs to the authoritative supervisor.
 * Persistence hooks must complete synchronously. emit owns one acknowledgement callback
 * for the combined receipt and untouched worker frame; supervisor owns hanging writes.
 */
export function createActionReceiptTracker({arm,bindings,checkActive,persistInput,persistFeedback,emit,persistAck}) {
 if(!ARMS.includes(arm))throw Error('unavailable arm');
 if(!bindings || Object.keys(bindings).sort().join(',')!==[...BINDINGS].sort().join(',') || BINDINGS.some(key=>typeof bindings[key]!=='string'||!/^[a-f0-9]{64}$/.test(bindings[key])))throw Error('invalid receipt bindings');
 for(const hook of [checkActive,persistInput,persistFeedback,emit,persistAck])if(typeof hook!=='function')throw Error('missing receipt callback');
 const bound=Object.freeze(Object.fromEntries(BINDINGS.map(key=>[key,bindings[key]]))),inputFrames=framer(LIMITS.lineBytes+1,'input'),feedbackFrames=framer(LIMITS.lineBytes,'feedback');
 let failure,pending=null,busy=false,inputEnded=false,feedbackEnded=false,receivedCount=0,acknowledgedCount=0,receiptOutputBytes=0,feedbackOutputBytes=0,submitted=false;
 /** Keep the first failure sticky, including rejected or late acknowledgement paths. */
 const fail=error=>{failure??=error instanceof Error?error:Error(String(error));return failure;};
 /** Prevent a purported synchronous persistence hook from continuing asynchronously. */
 const sync=(fn,...args)=>{const value=fn(...args);if(value && typeof value.then==='function'){Promise.resolve(value).catch(()=>{});throw Error('receipt persistence/checkActive must be synchronous');}return value;};
 /** Recheck failure and authoritative deadline around every externally owned effect. */
 const active=()=>{if(failure)throw failure;sync(checkActive);if(failure)throw failure;};
 const snapshot=()=>Object.freeze({receivedCount,acknowledgedCount,receiptOutputBytes,feedbackOutputBytes,submitted,pending:pending?.sequence??null,failed:!!failure});
 return Object.freeze({
  get snapshot(){return snapshot();},
  /** Validate and persist one raw input before returning bytes for worker forwarding. */
  input(chunk){try{
   active();if(inputEnded||feedbackEnded||submitted)throw Error('input after terminal/EOF');
   if(pending||busy)throw Error('input while action pending');
   const complete=inputFrames.push(chunk);if(!complete)return null;
   const {raw,SHA256}=complete;
   const sequence=receivedCount+1;
   if(sequence>LIMITS.rounds)throw Error('round limit');
   const action=parseAction(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw.subarray(0,-1)),arm,sequence);
   if(sequence===LIMITS.rounds && action.kind!=='submit')throw Error('final round reserved for submit');
   pending=Object.freeze({version:'native-action-reservation-v1',...bound,sequence,actionKind:action.kind,inputSHA256:SHA256,inputBytes:raw.length});
   busy=true;active();sync(persistInput,pending,Buffer.from(raw));active();receivedCount++;busy=false;
   return raw;
  }catch(error){throw fail(error);}},
  /** Match exactly one result to the sole pending action, then acknowledge its receipt. */
  async feedback(chunk){try{
   active();if(feedbackEnded||submitted||busy)throw Error('feedback after terminal/concurrent feedback');
   if(!pending)throw Error('feedback without pending action');
   const complete=feedbackFrames.push(chunk);if(!complete)return;
   const {raw,SHA256}=complete;
   const value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw));
   if(!value || typeof value!=='object' || Array.isArray(value))throw Error('invalid feedback');
   const keys=Object.keys(value).sort().join(',');
   if(pending.actionKind==='submit'){
    if(value.kind!=='submitted'||keys!=='kind,submission')throw Error('expected submitted feedback');
   }else if(value.kind!=='result'||value.sequence!==pending.sequence||keys!=='kind,result,sequence')throw Error('unexpected/replayed feedback');
   if(feedbackOutputBytes+raw.length>LIMITS.feedbackBytes)throw Error('feedback total limit');
   busy=true;
   const {version,...reservation}=pending;
   const receipt=Object.freeze({kind:'coordinator-action-receipt',version:'native-action-receipt-v1',scope:'coordinator byte observation; not native authorship or atomic delivery',...reservation,feedbackSHA256:SHA256,feedbackBytes:raw.length});
   const receiptFrame=Buffer.from(JSON.stringify(receipt)+'\n');
   if(receiptFrame.length>RECEIPT_LIMITS.frameBytes||receiptOutputBytes+receiptFrame.length>RECEIPT_LIMITS.totalBytes)throw Error('receipt byte limit');
   active();sync(persistFeedback,receipt,Buffer.from(raw));active();
   await emit(Buffer.from(receiptFrame),Buffer.from(raw));active();
   const ack=Object.freeze({version:'native-action-ack-v1',sequence:pending.sequence,receiptSHA256:digest(receiptFrame),receiptBytes:receiptFrame.length,feedbackSHA256:receipt.feedbackSHA256,feedbackBytes:raw.length,outputBytes:receiptFrame.length+raw.length});
   active();sync(persistAck,ack);active();
   acknowledgedCount++;receiptOutputBytes+=receiptFrame.length;feedbackOutputBytes+=raw.length;
   submitted=pending.actionKind==='submit';pending=null;busy=false;
  }catch(error){throw fail(error);}},
  /** Native EOF is complete only after an acknowledged submit and no byte fragments. */
  inputEOF(){try{active();if(inputFrames.pending||pending||busy||!submitted)throw Error('incomplete input EOF');inputEnded=true;}catch(error){throw fail(error);}},
  /** Worker EOF is complete only after an acknowledged submit and no byte fragments. */
  feedbackEOF(){try{active();if(feedbackFrames.pending||pending||busy||!submitted)throw Error('incomplete feedback EOF');feedbackEnded=true;}catch(error){throw fail(error);}},
  /** Verify terminal correlation independently of stream close ordering. */
  assertComplete(){try{active();if(inputFrames.pending||feedbackFrames.pending||pending||busy||!submitted||receivedCount!==acknowledgedCount)throw Error('incomplete action receipts');return snapshot();}catch(error){throw fail(error);}},
 });
}
