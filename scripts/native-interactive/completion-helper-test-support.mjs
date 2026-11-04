import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {digest} from './protocol.mjs';
import {nativeCompletionPaths,writeNativeExclusive,encodeNative} from './native-completion.mjs';
import {bootstrapCompletionTransport,captureCompletionTransport,observeCompletionTransport,readCompletionTransport,verifyCompletionTransport,completionTransportSourceBindings,TRANSPORT_READY,TRANSPORT_VERDICT} from './native-completion-transport.mjs';

const SUPERVISOR=770001;
const result=(output,fields)=>({output:output.toString('utf8'),wall_time_seconds:0,...fields});
const ack=async raw=>({bytes:raw.length,sha256:digest(raw)});
/** Bind a minimal public synthetic admission to the same fixed source checks, never bypass them. */
export function createFixedTransportTestBinding({cellDir,arm,cellId='synthetic',limitsSHA256}){
 const bindings=completionTransportSourceBindings(),raw=Buffer.from(JSON.stringify({testOnly:true,bindings},null,2)+'\n');
 writeNativeExclusive(path.join(cellDir,'admission.json'),raw);
 return {sourceSHA256:digest(bindings),admissionSHA256:digest(raw),cellId,arm,limitsSHA256};
}
/** Public no-model outer observations are synthetic. Inner original helper exits are real.
 * These controls never claim native-tool provenance or actual functions.exec store behavior.
 */
async function observe(f,sequence,stage,payload){
 const input=new PassThrough(),output=[];
 const observerInitial=result(TRANSPORT_READY,{session_id:770002});
 await observeCompletionTransport({cellDir:f.cellDir,sequence,stage,input,emit:async raw=>{
  output.push(Buffer.from(raw));if(raw.equals(TRANSPORT_READY))setImmediate(()=>input.end(encodeNative({...payload,observerInitial})));
  return ack(raw);
 }});
 assert.deepEqual(Buffer.concat(output),Buffer.concat([TRANSPORT_READY,TRANSPORT_VERDICT]));
}
/** Prepare all required pre-relay evidence using the production wrappers and original children. */
export async function captureThroughFixedHelpers(f,sequence,raw){
 const bootstrap=[];
 await bootstrapCompletionTransport({cellDir:f.cellDir,sequence,emit:async bytes=>{bootstrap.push(Buffer.from(bytes));return ack(bytes);}});
 await observe(f,sequence,'bootstrap-observe',{result:result(Buffer.concat(bootstrap),{exit_code:0})});
 const input=new PassThrough(),capture=[];
 await captureCompletionTransport({cellDir:f.cellDir,sequence,input,emit:async bytes=>{
  capture.push(Buffer.from(bytes));if(capture.length===1)setImmediate(()=>input.end(raw));return ack(bytes);
 }});
 await observe(f,sequence,'capture-observe',{initial:result(capture[0],{session_id:770003}),final:result(Buffer.concat(capture.slice(1)),{exit_code:0}),response:raw.toString('utf8')});
 const reader=[];
 await readCompletionTransport({cellDir:f.cellDir,sequence,emit:async bytes=>{reader.push(Buffer.from(bytes));return ack(bytes);}});
 assert.deepEqual(Buffer.concat(reader),raw);
 await observe(f,sequence,'reader-observe',{result:result(Buffer.concat(reader),{exit_code:0}),supervisorSessionId:SUPERVISOR});
 verifyCompletionTransport({cellDir:f.cellDir,sequence,through:'reader-observe',raw});
 writeNativeExclusive(path.join(f.base??f.cellDir,`fixed-transport-${sequence}-control-scope.json`),encodeNative({scope:'public no-model control: outer native result fields and sessions are synthetic; original helper subprocess close is actually observed',provider:false,actor:false,nativeToolPreflight:false}));
}
/** After actual bridge acceptance, retain synthetic outer write outcome separately from it. */
export async function finalizeFixedHelperRelay(f,sequence){
 await observe(f,sequence,'relay-outcome',{result:result(Buffer.alloc(0),{session_id:SUPERVISOR})});
 verifyCompletionTransport({cellDir:f.cellDir,sequence});
}
/** Wait only in public synthetic integration controls for the real worker's terminal file.
 * Production native orchestration never polls or retries an uncertain write for admission.
 */
export async function awaitFixedHelperRelay(f,sequence){
 const file=nativeCompletionPaths(f.cellDir,sequence).terminal,deadline=Date.now()+1000;
 while(!fs.existsSync(file)){if(Date.now()>=deadline)throw Error('synthetic worker acceptance observation deadline');await new Promise(resolve=>setTimeout(resolve,5));}
 await finalizeFixedHelperRelay(f,sequence);
}
