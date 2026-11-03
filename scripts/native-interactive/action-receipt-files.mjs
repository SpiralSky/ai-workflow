import fs from 'node:fs';
import path from 'node:path';
import {digest,LIMITS,parseAction} from './protocol.mjs';
import {readBounded} from './files.mjs';
const RECEIPT_BYTES=4096;
const SCOPE='coordinator byte observation; not native authorship or atomic delivery';
const suffixes=['input.jsonl','input.json','feedback.jsonl','receipt.jsonl','ack.json'];
const encode=value=>Buffer.from(JSON.stringify(value)+'\n');
const decode=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));
/** Fixed canonical coordinator directory, never an arbitrary actor-selected destination. */
function directory(cellDir){if(!path.isAbsolute(cellDir)||path.resolve(cellDir)!==cellDir||fs.realpathSync(cellDir)!==cellDir)throw Error('noncanonical action receipt cell');return path.join(cellDir,'action-receipts');}
function filename(dir,sequence,suffix){if(!Number.isSafeInteger(sequence)||sequence<1||sequence>LIMITS.rounds||!suffixes.includes(suffix))throw Error('invalid action receipt file');return path.join(dir,String(sequence).padStart(6,'0')+'.'+suffix);}
/** Exclusive file and directory sync; a partial failure is retained and never retried. */
function exclusive(file,bytes){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const parent=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}
/** Reserve a fresh fixed store before worker launch; callbacks persist before dependent effects. */
export function createActionReceiptStore({cellDir}){
 const dir=directory(cellDir);fs.mkdirSync(dir,{mode:0o700});let failed=false;
 const write=(sequence,suffix,bytes)=>{if(failed)throw Error('action receipt store failed');try{exclusive(filename(dir,sequence,suffix),bytes);}catch(error){failed=true;throw error;}};
 return {
  persistInput(record,raw){write(record.sequence,'input.jsonl',raw);write(record.sequence,'input.json',encode(record));},
  persistFeedback(record,raw){write(record.sequence,'feedback.jsonl',raw);write(record.sequence,'receipt.jsonl',encode(record));},
  persistAck(record){write(record.sequence,'ack.json',encode(record));}
 };
}
/** Recompute received bytes and bind them to the existing semantic/emit journal after clean close.
 * This validates local artifacts only, not native authorship or external transport delivery.
 */
export function validateActionReceiptEvidence({cellDir,supervision}){
 const dir=directory(cellDir),summary=supervision.actionReceipts;
 if(!summary||summary.failed!==false||summary.pending!==null||summary.submitted!==true||!Number.isSafeInteger(summary.receivedCount)||summary.receivedCount<1||summary.receivedCount>LIMITS.rounds||summary.acknowledgedCount!==summary.receivedCount)throw Error('incomplete action receipt sequence');
 if(fs.realpathSync(dir)!==dir||!fs.lstatSync(dir).isDirectory())throw Error('unsafe action receipt directory');
 const names=fs.readdirSync(dir).sort(),expected=[];for(let seq=1;seq<=summary.receivedCount;seq++)for(const suffix of suffixes)expected.push(path.basename(filename(dir,seq,suffix)));
 if(JSON.stringify(names)!==JSON.stringify(expected.sort()))throw Error('missing or dangling action receipt files');
 const hashFile=name=>digest(readBounded(path.join(cellDir,name),1048576));
 const bindings={assignmentSHA256:hashFile('assignment.json'),admissionSHA256:hashFile('admission.json'),configSHA256:hashFile('config.json'),supervisorStartSHA256:hashFile('supervisor-start.json'),dispatchIntentSHA256:hashFile('actor-dispatch-intent.json')};
 const config=decode(readBounded(path.join(cellDir,'config.json'),16384)),journalDir=path.join(cellDir,'journal'),journalNames=fs.readdirSync(journalDir).sort();
 if(!journalNames.length||journalNames.length>2048||journalNames.some((name,index)=>name!==String(index+1).padStart(6,'0')+'.json'))throw Error('invalid action receipt journal');
 const events=journalNames.map(name=>decode(readBounded(path.join(journalDir,name)))),reserved=events.filter(event=>event.type==='reserved'),emitted=events.filter(event=>event.type==='emission-attempt'&&event.initial===false);
 if(reserved.length!==summary.receivedCount||emitted.length!==summary.receivedCount)throw Error('action receipt journal count mismatch');
 const observations=supervision.timing?.observations,received=observations?.filter(event=>event.type==='action-received')??[],acknowledged=observations?.filter(event=>event.type==='action-receipt-ack')??[];
 if(received.length!==summary.receivedCount||acknowledged.length!==summary.receivedCount)throw Error('action receipt observations incomplete');
 let receiptBytes=0,feedbackBytes=0,inputBytes=0,previousIndex=-1;const identities=[];
 for(let sequence=1;sequence<=summary.receivedCount;sequence++){
  const read=(suffix,max)=>readBounded(filename(dir,sequence,suffix),max);
  const raw=read('input.jsonl',LIMITS.lineBytes+1),feedback=read('feedback.jsonl',LIMITS.lineBytes);
  if(raw.at(-1)!==10||raw.indexOf(10)!==raw.length-1||feedback.at(-1)!==10||feedback.indexOf(10)!==feedback.length-1)throw Error('action receipt LF framing mismatch');
  const action=parseAction(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw.subarray(0,-1)),config.arm,sequence),parsedFeedback=decode(feedback);
  if((sequence===LIMITS.rounds&&action.kind!=='submit')||(sequence===summary.receivedCount)!==(action.kind==='submit'))throw Error('action receipt terminal sequence mismatch');
  if(JSON.stringify(action)!==JSON.stringify(reserved[sequence-1].action)||typeof emitted[sequence-1].text!=='string'||!Buffer.from(emitted[sequence-1].text).equals(feedback))throw Error('action receipt differs from worker journal');
  if(action.kind==='submit'?parsedFeedback.kind!=='submitted'||Object.keys(parsedFeedback).sort().join(',')!=='kind,submission':parsedFeedback.kind!=='result'||parsedFeedback.sequence!==sequence||Object.keys(parsedFeedback).sort().join(',')!=='kind,result,sequence')throw Error('action feedback sequence mismatch');
  const input={version:'native-action-reservation-v1',...bindings,sequence,actionKind:action.kind,inputSHA256:digest(raw),inputBytes:raw.length};
  const receipt={kind:'coordinator-action-receipt',version:'native-action-receipt-v1',scope:SCOPE,...bindings,sequence,actionKind:action.kind,inputSHA256:digest(raw),inputBytes:raw.length,feedbackSHA256:digest(feedback),feedbackBytes:feedback.length};
  const receiptFrame=encode(receipt),ack={version:'native-action-ack-v1',sequence,receiptSHA256:digest(receiptFrame),receiptBytes:receiptFrame.length,feedbackSHA256:digest(feedback),feedbackBytes:feedback.length,outputBytes:receiptFrame.length+feedback.length};
  if(receiptFrame.length>RECEIPT_BYTES||!read('input.json',RECEIPT_BYTES).equals(encode(input))||!read('receipt.jsonl',RECEIPT_BYTES).equals(receiptFrame)||!read('ack.json',RECEIPT_BYTES).equals(encode(ack)))throw Error('action receipt binding mismatch');
  const receivedEvent=received[sequence-1],ackEvent=acknowledged[sequence-1],receivedIndex=observations.indexOf(receivedEvent),ackIndex=observations.indexOf(ackEvent);
  if(receivedEvent.sequence!==sequence||receivedEvent.assignmentSHA256!==bindings.assignmentSHA256||receivedEvent.inputSHA256!==input.inputSHA256||receivedEvent.inputBytes!==input.inputBytes||ackEvent.sequence!==sequence||ackEvent.receiptSHA256!==ack.receiptSHA256||ackEvent.receiptBytes!==ack.receiptBytes||ackEvent.feedbackSHA256!==ack.feedbackSHA256||ackEvent.feedbackBytes!==ack.feedbackBytes||receivedIndex<=previousIndex||ackIndex<=receivedIndex||!Number.isFinite(receivedEvent.monotonicMs)||!Number.isFinite(ackEvent.monotonicMs)||ackEvent.monotonicMs<receivedEvent.monotonicMs)throw Error('action receipt observation mismatch');
  previousIndex=ackIndex;inputBytes+=raw.length;receiptBytes+=receiptFrame.length;feedbackBytes+=feedback.length;identities.push({sequence,inputSHA256:input.inputSHA256,receiptSHA256:ack.receiptSHA256,ackSHA256:digest(encode(ack))});
 }
 if(inputBytes!==supervision.bytesIn||feedbackBytes!==supervision.outcome?.visibleFeedbackBytes)throw Error('action receipt worker byte accounting mismatch');
 if(receiptBytes>LIMITS.rounds*RECEIPT_BYTES||summary.receiptOutputBytes!==receiptBytes||summary.feedbackOutputBytes!==feedbackBytes||supervision.coordinatorActionReceiptBytes!==receiptBytes)throw Error('action receipt byte accounting mismatch');
 return {count:summary.receivedCount,inputBytes,receiptBytes,feedbackBytes,identitySHA256:digest(identities),scope:SCOPE};
}
