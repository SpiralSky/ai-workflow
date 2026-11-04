import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {digest,monotonicNow} from './protocol.mjs';
import {readBounded} from './files.mjs';
import {nativeCompletionPaths,parseNativeCompletionFrame,encodeNative,nativeKeys,writeNativeExclusive,assertNativeCompletionActive} from './native-completion.mjs';
export const NATIVE_COMPLETION_BOOTSTRAP_LIMITS=Object.freeze({frameBytes:98304,totalBytes:1048576,timeoutMs:60000});
const CAP=NATIVE_COMPLETION_BOOTSTRAP_LIMITS.frameBytes,TOTAL=NATIVE_COMPLETION_BOOTSTRAP_LIMITS.totalBytes;
const SCOPE='exact bounded helper stdout and trusted normal-exit coordinator assertion (not authenticated tool receipt); not model consumption, API roles, actor authentication, isolation, tokens or billing';
/** Frozen identical wrapper in both arms; exact engine-bound request bytes remain contiguous. */
export function generateNativeCompletionBootstrap(raw){
 const request=parseNativeCompletionFrame(raw);if(request.version!=='native-completion-request-v1')throw Error('native bootstrap request version');
 const header=Buffer.from('NATIVE_COMPLETION_BEGIN v1\nProduce the bound completion envelope without executing project tool calls. Submit it only through the fixed coordinator transport instructions. Stop if the final marker is missing.\nrequestBytes='+raw.length+' requestSHA256='+digest(raw)+'\nNATIVE_COMPLETION_REQUEST_BEGIN\n');
 const body=Buffer.concat([header,raw,Buffer.from('NATIVE_COMPLETION_REQUEST_END\n')]);
 const output=Buffer.concat([body,Buffer.from('NATIVE_COMPLETION_END v1 bodyBytes='+body.length+' bodySHA256='+digest(body)+'\n')]);
 if(output.length>CAP)throw Error('native completion bootstrap wrapper limit');return output;
}
/** Fixed helper command; argv contains only trusted canonical metadata, never actor bytes. */
export function completionBootstrapCommand({cellDir,sequence,node=process.execPath}){nativeCompletionPaths(cellDir,sequence);const script=path.join(import.meta.dirname,'native-completion-bootstrap.mjs');for(const value of [node,script,cellDir])if(!/^\/[A-Za-z0-9_./-]+$/.test(value)||path.resolve(value)!==value)throw Error('unsafe bootstrap command path');return `exec ${node} ${script} ${cellDir} ${sequence}`;}
/** Emit one exclusively reserved exact wrapper and retain uncertain/failed output for inspection. */
export async function runNativeCompletionBootstrap({cellDir,sequence,emit,signal}){
 const p=nativeCompletionPaths(cellDir,sequence);if(typeof emit!=='function')throw Error('native bootstrap emitter required');
 const started=monotonicNow(),deadline=started+Math.min(NATIVE_COMPLETION_BOOTSTRAP_LIMITS.timeoutMs,assertNativeCompletionActive({cellDir,sequence})),requestRaw=readBounded(p.request,CAP),request=parseNativeCompletionFrame(requestRaw);let timer,rejectAbort;
 const check=()=>{assertNativeCompletionActive({cellDir,sequence});if(signal?.aborted)throw Error('native bootstrap cancelled');if(monotonicNow()>=deadline)throw Error('native bootstrap deadline');if(!readBounded(p.request,CAP).equals(requestRaw))throw Error('native bootstrap request drift');};
 writeNativeExclusive(p['bootstrap-attempt'],encodeNative({version:'native-completion-bootstrap-attempt-v1',binding:request.binding,completionId:request.completionId,sequence,requestSHA256:digest(requestRaw),scope:SCOPE}));
 const abort=()=>rejectAbort?.(Error('native bootstrap cancelled'));
 try{check();const output=generateNativeCompletionBootstrap(requestRaw);let total=output.length;for(let n=1;n<=32;n++){const paths=nativeCompletionPaths(cellDir,n);if(n!==sequence&&fs.existsSync(paths['bootstrap-output']))total+=readBounded(paths['bootstrap-output'],CAP).length;if(fs.existsSync(paths['capture-attempt']))total+=Buffer.byteLength('{"kind":"native-completion-capture-ready","version":"native-completion-capture-stdin-v1"}\n');if(fs.existsSync(paths['capture-receipt']))total+=readBounded(paths['capture-receipt'],1024).length;}if(total>TOTAL)throw Error('native bootstrap aggregate limit');writeNativeExclusive(p['bootstrap-output'],output);check();
 const acknowledgement=await new Promise((resolve,reject)=>{rejectAbort=reject;timer=setTimeout(()=>reject(Error('native bootstrap deadline')),Math.max(0,deadline-monotonicNow()));signal?.addEventListener('abort',abort,{once:true});Promise.resolve().then(()=>{check();return emit(Buffer.from(output));}).then(resolve,reject);});check();nativeKeys(acknowledgement,['bytes','sha256']);if(acknowledgement.bytes!==output.length||acknowledgement.sha256!==digest(output))throw Error('native bootstrap output acknowledgement');
 const receipt={version:'native-completion-bootstrap-receipt-v1',binding:request.binding,completionId:request.completionId,sequence,requestSHA256:digest(requestRaw),outputBytes:output.length,outputSHA256:digest(output),scope:SCOPE};writeNativeExclusive(p['bootstrap-receipt'],encodeNative(receipt));check();return receipt;
 }catch(error){try{writeNativeExclusive(p['bootstrap-failure'],encodeNative({version:'native-completion-bootstrap-failure-v1',sequence,reason:error.message}));}catch{}throw error;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
/** Trusted observer records actual normal helper exit and exact collected stdout before relay. */
export function recordNativeCompletionBootstrapExit({cellDir,sequence,output,exitCode,signal}){
 const p=nativeCompletionPaths(cellDir,sequence);try{assertNativeCompletionActive({cellDir,sequence});if(exitCode!==0||signal!==null)throw Error('native bootstrap abnormal exit');const expected=generateNativeCompletionBootstrap(readBounded(p.request,CAP));if(!Buffer.isBuffer(output)||!output.equals(expected)||!readBounded(p['bootstrap-output'],CAP).equals(output))throw Error('native bootstrap truncated or changed stdout');
 const receipt=parseNativeCompletionFrame(readBounded(p['bootstrap-receipt'],4096));if(receipt.outputSHA256!==digest(output)||receipt.outputBytes!==output.length)throw Error('native bootstrap receipt mismatch');assertNativeCompletionActive({cellDir,sequence});writeNativeExclusive(p['bootstrap-exit'],encodeNative({version:'native-completion-bootstrap-exit-v1',sequence,exitCode:0,signal:null,outputBytes:output.length,outputSHA256:digest(output),receiptSHA256:digest(readBounded(p['bootstrap-receipt'],4096)),scope:SCOPE}));assertNativeCompletionActive({cellDir,sequence});return verifyNativeCompletionBootstrap({cellDir,sequence});}catch(error){try{writeNativeExclusive(p['bootstrap-failure'],encodeNative({version:'native-completion-bootstrap-failure-v1',sequence,reason:error.message}));}catch{}throw error;}
}
/** Independently reconstruct wrapper, original request, output receipt and normal-exit record. */
export function verifyNativeCompletionBootstrap({cellDir,sequence}){
 const p=nativeCompletionPaths(cellDir,sequence);if(fs.existsSync(p['bootstrap-failure']))throw Error('native bootstrap failed');const raw=readBounded(p.request,CAP),request=parseNativeCompletionFrame(raw),expected=generateNativeCompletionBootstrap(raw),output=readBounded(p['bootstrap-output'],CAP),attempt=parseNativeCompletionFrame(readBounded(p['bootstrap-attempt'],4096)),receiptRaw=readBounded(p['bootstrap-receipt'],4096),receipt=parseNativeCompletionFrame(receiptRaw),exit=parseNativeCompletionFrame(readBounded(p['bootstrap-exit'],4096));
 const expectedAttempt={version:'native-completion-bootstrap-attempt-v1',binding:request.binding,completionId:request.completionId,sequence,requestSHA256:digest(raw),scope:SCOPE};
 const expectedReceipt={version:'native-completion-bootstrap-receipt-v1',binding:request.binding,completionId:request.completionId,sequence,requestSHA256:digest(raw),outputBytes:expected.length,outputSHA256:digest(expected),scope:SCOPE};
 const expectedExit={version:'native-completion-bootstrap-exit-v1',sequence,exitCode:0,signal:null,outputBytes:expected.length,outputSHA256:digest(expected),receiptSHA256:digest(receiptRaw),scope:SCOPE};
 if(!output.equals(expected)||JSON.stringify(attempt)!==JSON.stringify(expectedAttempt)||JSON.stringify(receipt)!==JSON.stringify(expectedReceipt)||JSON.stringify(exit)!==JSON.stringify(expectedExit))throw Error('native bootstrap evidence mismatch');return {outputBytes:output.length,outputSHA256:digest(output),requestSHA256:digest(raw)};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const abort=new AbortController(),stop=()=>abort.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{if(process.argv.length!==4||!/^(?:[1-9]|[12][0-9]|3[0-2])$/.test(process.argv[3]))throw Error('usage: native-completion-bootstrap.mjs CELL_DIR SEQUENCE');await runNativeCompletionBootstrap({cellDir:process.argv[2],sequence:Number(process.argv[3]),signal:abort.signal,emit:raw=>new Promise((resolve,reject)=>{const failed=()=>reject(Error('native bootstrap stdout failure'));process.stdout.once('error',failed);process.stdout.write(raw,error=>{if(error)reject(error);else{process.stdout.off('error',failed);resolve({bytes:raw.length,sha256:digest(raw)});}});})});}catch{process.exitCode=1;process.stderr.write('native completion bootstrap incomplete; retain evidence and do not dispatch or retry\n');}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
