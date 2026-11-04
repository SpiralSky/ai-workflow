import {Socket} from 'node:net';
import {createCompletionIPCFramer,COMPLETION_TRANSPORT_LIMITS} from './completion-lane.mjs';
import {parseNativeCompletionFrame} from './native-completion.mjs';
/** Fixed inherited duplex descriptor, never an actor-selected endpoint or listener. */
export function createWorkerCompletionLane({binding,onFatal,accept,stream=new Socket({fd:3,readable:true,writable:true})}){
 const framer=createCompletionIPCFramer();let grant,closeWait,closed=false,failure,outputBytes=0,queue=Promise.resolve();
 const fatal=error=>{if(failure)return;failure=error instanceof Error?error:Error(String(error));grant?.reject(failure);closeWait?.reject(failure);onFatal(failure);};
 const send=value=>{const raw=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value)+'\n');outputBytes+=raw.length;if(raw.length>COMPLETION_TRANSPORT_LIMITS.frameBytes||outputBytes>COMPLETION_TRANSPORT_LIMITS.laneBytes){const error=Error('worker completion output limit');fatal(error);return Promise.reject(error);}return new Promise((resolve,reject)=>{stream.write(raw,error=>error?reject(error):resolve());});};
 stream.on('data',chunk=>{try{for(const raw of framer.push(chunk)){queue=queue.then(async()=>{if(failure)throw failure;const frame=parseNativeCompletionFrame(raw);if(frame.version==='native-completion-grant-v1'){if(!grant||frame.completionId!==grant.id||Object.keys(frame).sort().join(',')!=='capability,completionId,version'||typeof frame.capability!=='string'||!/^[a-f0-9]{64}$/.test(frame.capability))throw Error('unexpected completion grant');const pending=grant;grant=undefined;pending.resolve(frame.capability);}else if(frame.version==='native-completion-close-ack-v1'){if(!closeWait||JSON.stringify(frame.binding)!==JSON.stringify(binding)||Object.keys(frame).sort().join(',')!=='binding,version')throw Error('unexpected close acknowledgement');closed=true;closeWait.resolve();closeWait=undefined;stream.end(()=>stream.destroy());}else if(frame.version==='native-completion-response-v1')await accept(raw);else throw Error('unexpected completion IPC');}).catch(fatal);}}catch(e){fatal(e);}});
 stream.on('error',fatal);stream.on('end',()=>{try{framer.eof();if(!closed)throw Error('completion IPC closed without agreement');}catch(e){fatal(e);}});
 return {issueCapability(reservation){if(failure)return Promise.reject(failure);if(grant||closed)return Promise.reject(Error('completion grant overlap'));return new Promise((resolve,reject)=>{grant={id:reservation.completionId,resolve,reject};send(reservation).catch(fatal);});},emitRequest:send,
  notifyFatal(error){fatal(error);return send({version:'native-completion-fatal-v1',binding,reason:String(failure)}).catch(()=>{stream.destroy();});},
  close(evidence){if(failure)return Promise.reject(failure);if(closeWait||closed)return Promise.reject(Error('completion close replay'));return new Promise((resolve,reject)=>{closeWait={resolve,reject};send({version:'native-completion-close-v1',binding,completion:evidence.completion.summary,event:evidence.event.summary}).catch(fatal);});},
  destroy(){stream.destroy();},get failed(){return !!failure;},get closed(){return closed;},
 };
}
