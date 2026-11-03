import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {LIMITS,ARMS,digest,parseAction,monotonicNow} from './protocol.mjs';
import {readBounded} from './files.mjs';

export const ACTOR_DATA_LIMITS=Object.freeze({inputBytes:LIMITS.lineBytes+1,outputBytes:1024,timeoutMs:60000});
export const ACTOR_DATA_READY=Buffer.from('{"kind":"actor-data-ready","version":"actor-data-stdin-v1"}\n');
const CLOCK=Object.freeze({now:monotonicNow,setTimeout,clearTimeout});
const SCOPE='exact actor input bytes captured as data; not authorship, isolation, or action execution';

/** Coordinator-selected fixed filenames only. No actor-provided path is accepted. */
export function actorDataPaths(cellDir,sequence){
 if(typeof cellDir!=='string'||!path.isAbsolute(cellDir)||path.resolve(cellDir)!==cellDir||fs.realpathSync(cellDir)!==cellDir||!fs.lstatSync(cellDir).isDirectory())throw Error('noncanonical actor data cell');
 if(!Number.isSafeInteger(sequence)||sequence<1||sequence>LIMITS.rounds)throw Error('invalid actor data sequence');
 const name='actor-data-'+String(sequence).padStart(6,'0');
 return {input:path.join(cellDir,name+'.jsonl'),receipt:path.join(cellDir,name+'.receipt.json'),attempt:path.join(cellDir,name+'.attempt.json'),failure:path.join(cellDir,name+'.failed.json')};
}
/** Exclusive bounded local evidence. Failed attempts and partial files are retained. */
function exclusive(file,bytes){
 const fd=fs.openSync(file,'wx',0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const directory=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
}
const encode=value=>Buffer.from(JSON.stringify(value)+'\n');

/** Generate a command from coordinator metadata only, never from actor text.
 * The actor's exact JSON line must subsequently be supplied through write_stdin.chars.
 * Safe-path restriction deliberately refuses unusual paths instead of shell quoting them.
 */
export function actorDataCommand({cellDir,arm,sequence,node=process.execPath}){
 actorDataPaths(cellDir,sequence);
 if(!ARMS.includes(arm))throw Error('invalid actor data arm');
 const script=path.resolve(import.meta.dirname,'actor-data.mjs');
 for(const value of [node,script,cellDir])if(!/^\/[A-Za-z0-9_./-]+$/.test(value)||path.resolve(value)!==value)throw Error('unsafe command path');
 return `exec ${node} ${script} ${cellDir} ${arm} ${sequence}`;
}

/** Read one bounded LF action frame from a data stream and persist it before relay.
 * This function never invokes a shell, a subprocess, an evaluator, a tool, or an actor.
 * The caller must require normal exit and verify the receipt before forwarding input.
 * Deadline checks surround bounded synchronous filesystem work; they are not an OS kill guarantee.
 */
export async function captureActorData({cellDir,arm,sequence,input,emit,onReady,clock=CLOCK,signal}){
 const files=actorDataPaths(cellDir,sequence);
 if(!ARMS.includes(arm)||!input?.on||typeof emit!=='function'||(onReady!==undefined&&typeof onReady!=='function'))throw Error('invalid actor data capture');
 if(Object.values(files).some(file=>fs.existsSync(file)))throw Error('actor data already attempted');
 const started=clock.now(),deadline=started+ACTOR_DATA_LIMITS.timeoutMs;
 if(!Number.isFinite(started)||started<0)throw Error('invalid actor data clock');
 let last=started,timer,fd,bytes=0,raw,settled=false,rejectWait,rejectOutput,receivedCleanup,streamFailure,outputBytes=0;
 const check=()=>{if(streamFailure)throw streamFailure;const now=clock.now();if(!Number.isFinite(now)||now<last)throw Error('invalid actor data clock');last=now;if(signal?.aborted)throw Error('actor data cancelled');if(now>=deadline)throw Error('actor data deadline');};
 const failWait=error=>{streamFailure??=error;settled=true;rejectWait?.(error);rejectOutput?.(error);};
 const cancelled=()=>failWait(Error('actor data cancelled'));
 exclusive(files.attempt,encode({version:'actor-data-attempt-v1',arm,sequence,startedMonotonicMs:started,deadlineMonotonicMs:deadline,scope:SCOPE}));
 try{
  check();fd=fs.openSync(files.input,'wx',0o600);
  const chunks=[];
  const deliver=async(output,emitter)=>{
   check();outputBytes+=output.length;if(outputBytes>ACTOR_DATA_LIMITS.outputBytes)throw Error('actor data output limit');
   const acknowledgement=await new Promise((resolve,reject)=>{
    let done=false;
    const finish=(error,value)=>{if(done)return;done=true;error?reject(error):resolve(value);};
    rejectOutput=error=>finish(error);
    Promise.resolve().then(()=>{check();return emitter(Buffer.from(output));}).then(value=>{try{check();finish(undefined,value);}catch(error){finish(error);}},()=>finish(Error('actor data output failed')));
   });
   rejectOutput=undefined;check();
   if(acknowledgement?.bytes!==output.length||acknowledgement?.sha256!==digest(output))throw Error('actor data output acknowledgement mismatch');
  };
  const received=new Promise((resolve,reject)=>{
   rejectWait=reject;
   const onData=chunk=>{try{
    check();if(settled)throw Error('actor data after frame');
    if(!Buffer.isBuffer(chunk))throw Error('actor data requires raw bytes');
    if(bytes+chunk.length>ACTOR_DATA_LIMITS.inputBytes)throw Error('actor data input limit');
    const newline=chunk.indexOf(10);if(newline!==-1&&newline!==chunk.length-1)throw Error('actor data coalesced extra bytes');
    if(chunk.length){const copy=Buffer.from(chunk);chunks.push(copy);fs.writeFileSync(fd,copy);bytes+=copy.length;}
    check();if(newline!==-1){settled=true;resolve(Buffer.concat(chunks,bytes));}
   }catch(error){failWait(error);}};
   const onEnd=()=>{if(!settled)failWait(Error('actor data EOF before frame'));};
   const onError=()=>failWait(Error('actor data input error'));
   input.on('data',onData);input.once('end',onEnd);input.once('error',onError);
   receivedCleanup=()=>{input.off('data',onData);input.off('end',onEnd);input.off('error',onError);input.pause?.();};
   timer=clock.setTimeout(()=>failWait(Error('actor data deadline')),Math.max(0,deadline-clock.now()));
   signal?.addEventListener('abort',cancelled,{once:true});
  });
  received.catch(()=>{});
  if(onReady)await deliver(ACTOR_DATA_READY,onReady);
  raw=await received;
  check();if(streamFailure)throw streamFailure;
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw.subarray(0,-1));
  parseAction(text,arm,sequence);
  if(sequence===LIMITS.rounds&&JSON.parse(text).kind!=='submit')throw Error('final actor data round reserved for submit');
  fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;check();
  if(!readBounded(files.input,ACTOR_DATA_LIMITS.inputBytes).equals(raw))throw Error('actor data changed during capture');
  const receipt={version:'actor-data-receipt-v1',arm,sequence,inputBytes:raw.length,inputSHA256:digest(raw),scope:SCOPE};
  await deliver(encode(receipt),emit);
  exclusive(files.receipt,encode(receipt));check();
  return receipt;
 }catch(error){try{exclusive(files.failure,encode({version:'actor-data-failure-v1',arm,sequence,status:'incomplete',retainedBytes:bytes}));}catch{}throw error;
 }finally{receivedCleanup?.();clock.clearTimeout(timer);signal?.removeEventListener('abort',cancelled);if(fd!==undefined)fs.closeSync(fd);}
}

/** Native supervisor gate: require captured exact bytes before any actor action reaches worker stdin. */
export function verifyCapturedActorData({cellDir,arm,sequence,raw}){
 const files=actorDataPaths(cellDir,sequence);
 if(fs.existsSync(files.failure))throw Error('actor data capture failed');
 const attempt=JSON.parse(readBounded(files.attempt,1024));
 const receipt=JSON.parse(readBounded(files.receipt,ACTOR_DATA_LIMITS.outputBytes));
 if(!Buffer.isBuffer(raw)||raw.length>ACTOR_DATA_LIMITS.inputBytes||!readBounded(files.input,ACTOR_DATA_LIMITS.inputBytes).equals(raw))throw Error('actor data input mismatch');
 const expected={version:'actor-data-receipt-v1',arm,sequence,inputBytes:raw.length,inputSHA256:digest(raw),scope:SCOPE};
 if(JSON.stringify(receipt)!==JSON.stringify(expected)||attempt.version!=='actor-data-attempt-v1'||attempt.arm!==arm||attempt.sequence!==sequence)throw Error('actor data receipt mismatch');
 return expected;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const abort=new AbortController();const stop=()=>abort.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
 let rawTTY=false;
 try{
  if(process.argv.length!==5||!/^(?:[1-9]|1[0-2])$/.test(process.argv[4]))throw Error('usage: actor-data.mjs CELL_DIR ARM SEQUENCE');
  if(process.stdin.isTTY){process.stdin.setRawMode(true);rawTTY=true;}
  const emit=bytes=>new Promise((resolve,reject)=>{
   const failed=()=>reject(Error('actor data output failed'));process.stdout.once('error',failed);
   process.stdout.write(bytes,error=>{process.stdout.off('error',failed);error?reject(error):resolve({bytes:bytes.length,sha256:digest(bytes)});});
  });
  await captureActorData({cellDir:process.argv[2],arm:process.argv[3],sequence:Number(process.argv[4]),input:process.stdin,signal:abort.signal,onReady:emit,emit});
 }catch{process.exitCode=1;try{process.stderr.write('actor data capture incomplete; retain evidence and do not relay or retry\n');}catch{}}
 finally{if(rawTTY)process.stdin.setRawMode(false);process.stdin.pause();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
