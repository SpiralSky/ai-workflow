import {verifyCompletionTransport} from './native-completion-transport.mjs';
import {verifyNativeCompletionBootstrap} from './native-completion-bootstrap.mjs';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {digest,monotonicNow} from './protocol.mjs';
import {nativeCompletionPaths,parseNativeCompletionFrame,validateNativeCompletionResponse,writeNativeExclusive,assertNativeCompletionActive} from './native-completion.mjs';
import {readBounded} from './files.mjs';

export const NATIVE_COMPLETION_CAPTURE_LIMITS=Object.freeze({inputBytes:98304,outputBytes:1024,timeoutMs:60000});
export const NATIVE_COMPLETION_READY=Buffer.from('{"kind":"native-completion-capture-ready","version":"native-completion-capture-stdin-v1"}\n');
const CLOCK=Object.freeze({now:monotonicNow,setTimeout,clearTimeout});
const SCOPE='exact actor input bytes captured as data; not authorship, isolation, or action execution';

/** Coordinator-selected fixed filenames only. No actor-provided path is accepted. */
export function completionCapturePaths(cellDir,sequence){
 const p=nativeCompletionPaths(cellDir,sequence);
 return {input:p['capture-input'],receipt:p['capture-receipt'],attempt:p['capture-attempt'],failure:p['capture-failure']};
}
/** Exclusive bounded local evidence. Failed attempts and partial files are retained. */
function exclusive(file,bytes){writeNativeExclusive(file,bytes);}
const encode=value=>Buffer.from(JSON.stringify(value)+'\n');

/** Generate a command from coordinator metadata only, never from actor text.
 * The actor's exact JSON line must subsequently be supplied through write_stdin.chars.
 * Safe-path restriction deliberately refuses unusual paths instead of shell quoting them.
 */
export function completionCaptureCommand({cellDir,sequence,node=process.execPath}){
 completionCapturePaths(cellDir,sequence);
 const script=path.resolve(import.meta.dirname,'native-completion-capture.mjs');
 for(const value of [node,script,cellDir])if(!/^\/[A-Za-z0-9_./-]+$/.test(value)||path.resolve(value)!==value)throw Error('unsafe command path');
 return `exec ${node} ${script} ${cellDir} ${sequence}`;
}

/** Configure only the fixed CLI terminal, before any completion capture or READY output.
 * Both streams must be pipes or both must be the tool PTY. Never normalize observed bytes.
 * Injectable execution/diagnostics exist only for deterministic no-model failure controls.
 */
export function configureNativeCompletionTerminal({inputTTY=!!process.stdin.isTTY,outputTTY=!!process.stdout.isTTY,run=spawnSync,diagnostic=raw=>process.stderr.write(raw)}={}){
 if(inputTTY!==outputTTY)throw Error('native completion mixed terminal streams');
 if(!inputTTY)return;
 let result;
 try{result=run('/usr/bin/stty',['-onlcr'],{stdio:[1,'pipe','pipe'],shell:false,timeout:1000,killSignal:'SIGKILL',maxBuffer:1024});}
 catch(error){result={error,status:null,signal:null,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)};}
 if(result.error||result.status!==0||result.signal!==null||!Buffer.isBuffer(result.stdout)||!Buffer.isBuffer(result.stderr)||result.stdout.length||result.stderr.length){
  diagnostic(encode({kind:'native-completion-terminal-setup-failed',status:result.status??null,signal:result.signal??null,error:result.error?{code:result.error.code??null,message:String(result.error.message)}:null,stdoutBase64:Buffer.from(result.stdout??[]).toString('base64'),stderrBase64:Buffer.from(result.stderr??[]).toString('base64')}));
  throw Error('native completion terminal setup failed');
 }
}

/** Read one bounded LF completion frame from a data stream and persist it before relay.
 * This function never invokes a shell, a subprocess, an evaluator, a tool, or an actor.
 * The caller must require normal exit and verify the receipt before forwarding input.
 * Deadline checks surround bounded synchronous filesystem work; they are not an OS kill guarantee.
 */
export async function captureNativeCompletion({cellDir,sequence,input,emit,onReady,clock=CLOCK,signal}){
 const files=completionCapturePaths(cellDir,sequence);
 verifyNativeCompletionBootstrap({cellDir,sequence});
 assertNativeCompletionActive({cellDir,sequence});
 if(!input?.on||typeof emit!=='function'||typeof onReady!=='function')throw Error('invalid native completion capture');
 if(Object.values(files).some(file=>fs.existsSync(file)))throw Error('native completion capture already attempted');
 let priorInputBytes=0,priorOutputBytes=0;for(let n=1;n<=32;n++){const paths=nativeCompletionPaths(cellDir,n);if(fs.existsSync(paths['bootstrap-output']))priorOutputBytes+=readBounded(paths['bootstrap-output'],98304).length;if(n===sequence)continue;if(fs.existsSync(paths['capture-input']))priorInputBytes+=readBounded(paths['capture-input'],98304).length;if(fs.existsSync(paths['capture-attempt']))priorOutputBytes+=NATIVE_COMPLETION_READY.length;if(fs.existsSync(paths['capture-receipt']))priorOutputBytes+=readBounded(paths['capture-receipt'],1024).length;}
 const started=clock.now(),deadline=started+Math.min(NATIVE_COMPLETION_CAPTURE_LIMITS.timeoutMs,assertNativeCompletionActive({cellDir,sequence}));
 if(!Number.isFinite(started)||started<0)throw Error('invalid native completion capture clock');
 let last=started,timer,fd,bytes=0,receivedBytes=0,raw,settled=false,rejectWait,rejectOutput,receivedCleanup,streamFailure,outputBytes=0;
 const check=()=>{assertNativeCompletionActive({cellDir,sequence});if(streamFailure)throw streamFailure;const now=clock.now();if(!Number.isFinite(now)||now<last)throw Error('invalid native completion capture clock');last=now;if(signal?.aborted)throw Error('native completion capture cancelled');if(now>=deadline)throw Error('native completion capture deadline');};
 const failWait=error=>{streamFailure??=error;settled=true;rejectWait?.(error);rejectOutput?.(error);};
 const cancelled=()=>failWait(Error('native completion capture cancelled'));
 exclusive(files.attempt,encode({version:'native-completion-capture-attempt-v1',sequence,startedMonotonicMs:started,deadlineMonotonicMs:deadline,scope:SCOPE}));
 try{
  check();completionCapturePaths(cellDir,sequence);fd=fs.openSync(files.input,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  const chunks=[];
  const deliver=async(output,emitter)=>{
   check();outputBytes+=output.length;if(outputBytes>NATIVE_COMPLETION_CAPTURE_LIMITS.outputBytes||priorOutputBytes+outputBytes>1048576)throw Error('native completion capture output limit');
   const acknowledgement=await new Promise((resolve,reject)=>{
    let done=false;
    const finish=(error,value)=>{if(done)return;done=true;error?reject(error):resolve(value);};
    rejectOutput=error=>finish(error);
    Promise.resolve().then(()=>{check();return emitter(Buffer.from(output));}).then(value=>{try{check();finish(undefined,value);}catch(error){finish(error);}},()=>finish(Error('native completion capture output failed')));
   });
   rejectOutput=undefined;check();
   if(acknowledgement?.bytes!==output.length||acknowledgement?.sha256!==digest(output))throw Error('native completion capture output acknowledgement mismatch');
  };
  const received=new Promise((resolve,reject)=>{
   rejectWait=reject;
   const onData=chunk=>{try{
    check();if(settled)throw Error('native completion capture after frame');
    if(!Buffer.isBuffer(chunk))throw Error('native completion capture requires raw bytes');
    receivedBytes+=chunk.length;const available=Math.max(0,NATIVE_COMPLETION_CAPTURE_LIMITS.inputBytes-bytes);
    if(chunk.length){const copy=Buffer.from(chunk.subarray(0,available));chunks.push(copy);fs.writeFileSync(fd,copy);bytes+=copy.length;}
    if(receivedBytes>NATIVE_COMPLETION_CAPTURE_LIMITS.inputBytes||priorInputBytes+receivedBytes>1048576)throw Error('native completion capture input limit');
    const newline=chunk.indexOf(10);if(newline!==-1&&newline!==chunk.length-1)throw Error('native completion capture coalesced extra bytes');
    check();if(newline!==-1){settled=true;resolve(Buffer.concat(chunks,bytes));}
   }catch(error){failWait(error);}};
   const onEnd=()=>{if(!settled)failWait(Error('native completion capture EOF before frame'));};
   const onError=()=>failWait(Error('native completion capture input error'));
   input.on('data',onData);input.once('end',onEnd);input.once('error',onError);
   receivedCleanup=()=>{input.off('data',onData);input.off('end',onEnd);input.off('error',onError);input.pause?.();};
   timer=clock.setTimeout(()=>failWait(Error('native completion capture deadline')),Math.max(0,deadline-clock.now()));
   signal?.addEventListener('abort',cancelled,{once:true});
  });
  received.catch(()=>{});
  if(onReady)await deliver(NATIVE_COMPLETION_READY,onReady);
  raw=await received;
  check();if(streamFailure)throw streamFailure;
  const request=parseNativeCompletionFrame(readBounded(nativeCompletionPaths(cellDir,sequence).request,98304));
  validateNativeCompletionResponse(parseNativeCompletionFrame(raw),request);
  fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;check();
  if(!readBounded(files.input,NATIVE_COMPLETION_CAPTURE_LIMITS.inputBytes).equals(raw))throw Error('native completion capture changed during capture');
  const receipt={version:'native-completion-capture-receipt-v1',sequence,inputBytes:raw.length,inputSHA256:digest(raw),scope:SCOPE};
  await deliver(encode(receipt),emit);
  exclusive(files.receipt,encode(receipt));check();
  return receipt;
 }catch(error){try{exclusive(files.failure,encode({version:'native-completion-capture-failure-v1',sequence,status:'incomplete',retainedBytes:bytes,receivedBytes}));}catch{}throw error;
 }finally{receivedCleanup?.();clock.clearTimeout(timer);signal?.removeEventListener('abort',cancelled);if(fd!==undefined)fs.closeSync(fd);}
}

/** Native supervisor gate: require captured exact bytes before any completion reaches worker stdin. */
export function verifyCapturedNativeCompletionFiles({cellDir,sequence,raw}){
 const files=completionCapturePaths(cellDir,sequence);
 verifyNativeCompletionBootstrap({cellDir,sequence});
 if(fs.existsSync(files.failure))throw Error('native completion capture failed');
 const attempt=parseNativeCompletionFrame(readBounded(files.attempt,1024));
 const receipt=parseNativeCompletionFrame(readBounded(files.receipt,NATIVE_COMPLETION_CAPTURE_LIMITS.outputBytes));
 if(!Buffer.isBuffer(raw)||raw.length>NATIVE_COMPLETION_CAPTURE_LIMITS.inputBytes||!readBounded(files.input,NATIVE_COMPLETION_CAPTURE_LIMITS.inputBytes).equals(raw))throw Error('native completion capture input mismatch');
 const expected={version:'native-completion-capture-receipt-v1',sequence,inputBytes:raw.length,inputSHA256:digest(raw),scope:SCOPE};
 if(JSON.stringify(receipt)!==JSON.stringify(expected)||attempt.version!=='native-completion-capture-attempt-v1'||attempt.sequence!==sequence)throw Error('native completion capture receipt mismatch');
 const request=parseNativeCompletionFrame(readBounded(nativeCompletionPaths(cellDir,sequence).request,98304));
 validateNativeCompletionResponse(parseNativeCompletionFrame(raw),request);
 const receiptRaw=readBounded(files.receipt,1024),output=Buffer.concat([NATIVE_COMPLETION_READY,receiptRaw]);const exit=parseNativeCompletionFrame(readBounded(nativeCompletionPaths(cellDir,sequence)['capture-exit'],2048));const expectedExit={version:'native-completion-capture-exit-v1',sequence,exitCode:0,signal:null,inputSHA256:digest(raw),outputBytes:output.length,outputSHA256:digest(output),receiptSHA256:digest(receiptRaw)};if(JSON.stringify(exit)!==JSON.stringify(expectedExit))throw Error('native capture exit evidence');
 return expected;
}

/** Live original-helper gate, distinct from terminal-safe historical reconstruction. */
export function verifyCapturedNativeCompletion({cellDir,sequence,raw}){
 assertNativeCompletionActive({cellDir,sequence});
 const result=verifyCapturedNativeCompletionFiles({cellDir,sequence,raw});
 assertNativeCompletionActive({cellDir,sequence});return result;
}

/** Production supervisor gate additionally requires exact native-tool delivery and relay intent.
 * Original helper-only verification remains for the recorder before the outer observer exists.
 */
export function verifyDeliveredNativeCompletion({cellDir,sequence,raw}){
 assertNativeCompletionActive({cellDir,sequence});
 verifyCompletionTransport({cellDir,sequence,through:'reader-observe',raw});
 const result=verifyCapturedNativeCompletion({cellDir,sequence,raw});
 assertNativeCompletionActive({cellDir,sequence});return result;
}

/** Record observed normal helper exit and its exact ready/receipt stdout before any relay. */
export function recordNativeCompletionCaptureExit({cellDir,sequence,output,exitCode,signal}){
 const p=nativeCompletionPaths(cellDir,sequence);try{assertNativeCompletionActive({cellDir,sequence});verifyNativeCompletionBootstrap({cellDir,sequence});if(exitCode!==0||signal!==null)throw Error('native capture abnormal exit');const receiptRaw=readBounded(p['capture-receipt'],1024),expected=Buffer.concat([NATIVE_COMPLETION_READY,receiptRaw]),raw=readBounded(p['capture-input'],98304);if(!Buffer.isBuffer(output)||!output.equals(expected))throw Error('native capture truncated or changed stdout');
 assertNativeCompletionActive({cellDir,sequence});exclusive(p['capture-exit'],encode({version:'native-completion-capture-exit-v1',sequence,exitCode:0,signal:null,inputSHA256:digest(raw),outputBytes:output.length,outputSHA256:digest(output),receiptSHA256:digest(receiptRaw)}));assertNativeCompletionActive({cellDir,sequence});return verifyCapturedNativeCompletion({cellDir,sequence,raw});}catch(error){try{exclusive(p['capture-failure'],encode({version:'native-completion-capture-failure-v1',sequence,reason:error.message}));}catch{}throw error;}
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const abort=new AbortController();const stop=()=>abort.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
 let rawTTY=false;
 try{
  if(process.argv.length!==4||!/^(?:[1-9]|[12][0-9]|3[0-2])$/.test(process.argv[3]))throw Error('usage: native-completion-capture.mjs CELL_DIR SEQUENCE');
  if(process.stdin.isTTY){process.stdin.setRawMode(true);rawTTY=true;}
  configureNativeCompletionTerminal();
  const emit=bytes=>new Promise((resolve,reject)=>{
   const failed=()=>reject(Error('native completion capture output failed'));process.stdout.once('error',failed);
   process.stdout.write(bytes,error=>{process.stdout.off('error',failed);error?reject(error):resolve({bytes:bytes.length,sha256:digest(bytes)});});
  });
  await captureNativeCompletion({cellDir:process.argv[2],sequence:Number(process.argv[3]),input:process.stdin,signal:abort.signal,onReady:emit,emit});
 }catch{process.exitCode=1;try{process.stderr.write('native completion capture incomplete; retain evidence and do not relay or retry\n');}catch{}}
 finally{if(rawTTY)process.stdin.setRawMode(false);process.stdin.pause();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
