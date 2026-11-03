import {verifyCellPublicHandoff,readCellBootstrapReceipt} from './handoff-files.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {LIMITS,digest,monotonicNow} from './protocol.mjs';
import {readBounded} from './files.mjs';
import {readLinuxProcessIdentity,verifyReadyLiveness,identityKey} from './readiness.mjs';
export {readLinuxProcessIdentity,verifyReadyLiveness} from './readiness.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const REPO=path.resolve(HERE,'../..');
export const BOUNDS=Object.freeze({wallMs:LIMITS.assignmentMs,inputBytes:LIMITS.rounds*(LIMITS.lineBytes+1),outputBytes:LIMITS.feedbackBytes+LIMITS.lineBytes,stderrBytes:65536});
function readSmallJson(file) {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readBounded(file,16384)));}
export function readConfig(file) {return validateConfig(readSmallJson(file));}
export function validateConfig(c) {
 if(!c || typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['arm','root','allowedWritePaths','venv','journalDir','cellDir'].includes(k)))throw new Error('invalid config');
 if(!['direct','branch-expanded','branch-hotpath2'].includes(c.arm)||!Array.isArray(c.allowedWritePaths)||c.allowedWritePaths.some(p=>typeof p!=='string'))throw new Error('invalid config');
 for(const key of ['root','venv','journalDir','cellDir'])if(typeof c[key]!=='string'||!path.isAbsolute(c[key])||path.resolve(c[key])!==c[key])throw new Error('absolute canonical paths required');
 for(const key of ['root','venv','cellDir'])if(fs.realpathSync(c[key])!==c[key]||!fs.lstatSync(c[key]).isDirectory())throw new Error('canonical directory required');
 if(path.dirname(c.journalDir)!==c.cellDir||c.root===c.cellDir||c.root.startsWith(c.cellDir+path.sep)===false)throw new Error('cell containment required');
 return c;
}
export function sanitizedEnv(c,temp) {return {PATH:'/usr/local/bin:/usr/bin:/bin',HOME:temp,TMPDIR:temp,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',AIW_VENV:c.venv,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'};}
/** Persist exact public wire bytes without JSON reserialization. */
function exclusiveBytes(file,bytes){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function exclusive(file,value){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function aliveGroup(pid){try{process.kill(-pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
/** Common bounded natural exit grace; forced cleanup is never upgraded to success. */
export async function awaitGroupExit(pid,deadline,{probe=aliveGroup,now=monotonicNow,sleep=delay,inspect=groupMembers}={}) {
 const observations=[];
 while(true){const at=now(),present=probe(pid);observations.push({at,present,...(present?{group:inspect(pid)}:{})});if(!present)return {absent:true,observations};if(at>=deadline)return {absent:false,observations};await sleep(Math.min(25,deadline-at));}
}
function groupMembers(group){
 const members=[];let scanned=0;
 for(const pid of fs.readdirSync('/proc')){if(!/^\d+$/.test(pid))continue;if(++scanned>16384)return {members,complete:false};
  try{const text=fs.readFileSync(`/proc/${pid}/stat`,'utf8');if(text.length>8192)return {members,complete:false};const end=text.lastIndexOf(')'),begin=text.indexOf('('),fields=text.slice(end+2).trim().split(/\s+/);if(begin<0||end<=begin||fields.length<20||!/^\d+$/.test(fields[2])||!/^\d+$/.test(fields[19])||!/^[A-Za-z]$/.test(fields[0]))return {members,complete:false};if(Number(fields[2])===group)members.push({pid:Number(pid),comm:text.slice(text.indexOf('(')+1,end),state:fields[0],startTime:fields[19]});}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))return {members,complete:false};}
 }return {members,complete:true};
}
/** Preserve the exact bounded first JSON line before any delivery, including split UTF-8. */
export function createReadyFrameForwarder({persist,emit,onReady}){
 let buffered=Buffer.alloc(0),complete=false,failed=false;
 return async chunk=>{
  if(failed)throw Error('ready forwarder failed');
  try{
   if(complete){await emit(chunk);return;}
   const newline=chunk.indexOf(10),piece=newline<0?chunk:chunk.subarray(0,newline+1);
   if(buffered.length+piece.length>LIMITS.lineBytes)throw Error('ready packet too large');
   buffered=Buffer.concat([buffered,piece]);if(newline<0)return;
   const frame=buffered;buffered=Buffer.alloc(0);
   const text=new TextDecoder('utf-8',{fatal:true}).decode(frame);if(JSON.parse(text).kind!=='ready')throw Error('missing ready packet');
   await persist(frame);await emit(frame);await onReady(frame);complete=true;
   const tail=chunk.subarray(newline+1);if(tail.length)await emit(tail);
  }catch(error){failed=true;throw error;}
 };
}

export const COORDINATOR_CONTROL_BYTES=4096;
/** One coordinator-only envelope. It carries no actor prompt, operation, path or native receipt. */
export function parseCoordinatorDispatchControl(frame,expected){
 const bytes=Buffer.isBuffer(frame)?frame:Buffer.from(frame);
 if(bytes.length>COORDINATOR_CONTROL_BYTES||bytes.length===0||bytes.at(-1)!==10||bytes.subarray(0,-1).includes(10))throw Error('invalid coordinator control frame');
 const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,-1)));
 if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).sort().join(',')!=='actorId,assignmentSHA256,capabilitySHA256,handoffSHA256,kind'||request.kind!=='coordinator-dispatch-intent'||typeof request.actorId!=='string'||!request.actorId||request.actorId!==expected.actorId||request.assignmentSHA256!==expected.assignmentSHA256||!/^([a-f0-9]{64})$/.test(request.assignmentSHA256)||request.handoffSHA256!==expected.handoffSHA256||request.capabilitySHA256!==expected.capabilitySHA256||!/^([a-f0-9]{64})$/.test(request.handoffSHA256)||!/^([a-f0-9]{64})$/.test(request.capabilitySHA256))throw Error('invalid coordinator dispatch request');
 return request;
}
/** Default same-supervisor coordinator call. Runtime substitution is only for synthetic controls. */
async function recordCoordinatorIntent(options){const {recordActorDispatchIntent}=await import('./coordinator.mjs');return recordActorDispatchIntent(options);}

export const writeStream=(stream,data)=>new Promise((resolve,reject)=>{const onError=error=>reject(error);stream.once('error',onError);stream.write(data,error=>{if(error)reject(error);else{stream.off('error',onError);resolve();}});});
/** Finite worker, no model bridge. Clean means cooperative close + absent worker group, not an OS sandbox. */
export async function supervise(config,{input=process.stdin,stdout=s=>writeStream(process.stdout,s),stderr=s=>writeStream(process.stderr,s),clock={now:monotonicNow,setTimeout,clearTimeout},recordDispatchIntent=recordCoordinatorIntent}={}) {
 const c=validateConfig(config);if(process.platform!=='linux')throw new Error('cleanup assurance unsupported on this platform');
 const configBytes=readBounded(path.join(c.cellDir,'config.json'),16384),admissionBytes=readBounded(path.join(c.cellDir,'admission.json'));
 if(JSON.stringify(c)!==JSON.stringify(JSON.parse(configBytes.toString('utf8')))||JSON.stringify(JSON.parse(admissionBytes.toString('utf8')).config)!==JSON.stringify(c))throw new Error('config/admission mismatch');
 const admission=JSON.parse(admissionBytes.toString('utf8')),nativeAssignment=admission.evidenceMode==='native-assignment';
 const assignmentBytes=nativeAssignment?readBounded(path.join(c.cellDir,'assignment.json'),16384):undefined,assignment=assignmentBytes?JSON.parse(assignmentBytes.toString('utf8')):undefined;
 if(nativeAssignment&&(typeof assignment?.actorId!=='string'||!assignment.actorId))throw Error('native assignment identity required');
 const assignmentSHA256=assignmentBytes?digest(assignmentBytes):undefined;
 const configSHA256=digest(configBytes),admissionSHA256=digest(admissionBytes);
 const resultPath=path.join(c.cellDir,'supervisor-result.json');
 for(const name of ['ready-frame.jsonl','supervisor-start.json','supervisor-ready.json','supervisor-result.json','worker-outcome.json','worker-config.json'])if(fs.existsSync(path.join(c.cellDir,name)))throw new Error('cell already attempted');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'native-worker-'));
 const configPath=path.join(c.cellDir,'worker-config.json');exclusive(configPath,c);
 const env=sanitizedEnv(c,temp);
 let failure,bytesIn=0,bytesOut=0,bytesErr=0,exitCode,exitSignal,coordinatorInputBytes=0,coordinatorOutputBytes=0,coordinatorControls=0;
 let inputPhase=nativeAssignment?'waiting-ready':'tools',controlBuffer=Buffer.alloc(0),controlPromise=Promise.resolve(),inputEnded=false,readyEvidence,actorInputObserved=false,acceptedHandoff,bootstrap;
 const supervisorIdentity=readLinuxProcessIdentity(process.pid);
 const started=clock.now(),startedAtUTC=new Date().toISOString(),deadline=started+BOUNDS.wallMs,observations=[];let acceptingObservations=true,readyObserved=false;
 const observe=(type,fields={})=>{if(!acceptingObservations)return;const monotonicMs=clock.now();if(!Number.isFinite(monotonicMs)||monotonicMs<(observations.at(-1)?.monotonicMs??started))throw Error('invalid monotonic clock');const event={type,monotonicMs,observedAtUTC:new Date().toISOString(),...fields};observations.push(event);return event;};
 if(!Number.isFinite(started)||started<0)throw Error('invalid monotonic clock');
 observe('worker-spawn');
 exclusive(path.join(c.cellDir,'supervisor-start.json'),{kind:'supervisor-launch-observation',startedMonotonicMs:started,startedAtUTC,assignmentLimitMs:BOUNDS.wallMs,deadlineMonotonicMs:deadline,supervisorIdentity,assignmentSHA256,configSHA256,admissionSHA256,scope:'observation before spawn; not proof child executed'});
 const supervisorStartBytes=readBounded(path.join(c.cellDir,'supervisor-start.json'),16384),supervisorStartSHA256=digest(supervisorStartBytes),startEvidence=JSON.parse(supervisorStartBytes.toString('utf8'));
 const child=spawn(process.execPath,['--import',path.join(REPO,'node_modules/tsx/dist/loader.mjs'),path.join(HERE,'worker.ts'),configPath],{cwd:REPO,env,detached:true,stdio:['pipe','pipe','pipe']});
 let outputQueue=Promise.resolve(),errorQueue=Promise.resolve();
 const closed=new Promise(resolve=>child.once('close',()=>{observe('worker-close');resolve();}));
 const kill=()=>{if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')failure??='group kill uncertain';}};
 const fail=reason=>{if(!acceptingObservations)return;failure??=reason;input.pause?.();child.stdin.destroy();kill();};
 const timer=clock.setTimeout(()=>{observe('assignment-timeout');fail('wall timeout; cleanup uncertain');},Math.max(0,deadline-clock.now()));
 const acknowledgeReady=frame=>{
  if(readyObserved||!acceptingObservations)return;if(failure)throw Error('failed supervisor cannot acknowledge readiness');
  if(clock.now()>=deadline)throw Error('ready delivery after assignment deadline');
  const processes={supervisor:readLinuxProcessIdentity(process.pid),worker:readLinuxProcessIdentity(child.pid)};
  if(identityKey(processes.supervisor)!==identityKey(supervisorIdentity)||processes.worker.parentPid!==process.pid||processes.worker.processGroupId!==child.pid)throw Error('ready process identity mismatch');
  const ready=observe('ready-delivered',{readySHA256:digest(frame),readyFrameBytes:frame.length,readyFraming:'utf8-json-line-including-lf'});
  readyEvidence={kind:'supervisor-ready-acknowledgement',...ready,processes,processIdentityScope:'Linux procfs observer namespace; missing time namespace is unknown',supervisorStartSHA256,assignmentSHA256,configSHA256,admissionSHA256,scope:'stdout callback acknowledged exact ready frame; not proof of actor consumption'};
  exclusive(path.join(c.cellDir,'supervisor-ready.json'),readyEvidence);
  readyObserved=true;if(nativeAssignment)inputPhase='awaiting-control';
 };
 const forwardOutput=createReadyFrameForwarder({persist:frame=>{
  if(clock.now()>=deadline||failure)throw Error('ready persistence after assignment deadline or failure');
  exclusiveBytes(path.join(c.cellDir,'ready-frame.jsonl'),frame);
 },emit:stdout,onReady:acknowledgeReady});
 const performControl=async frame=>{
  const handoff=verifyCellPublicHandoff({cellDir:c.cellDir});
  const request=parseCoordinatorDispatchControl(frame,{actorId:assignment.actorId,assignmentSHA256,handoffSHA256:handoff.handoffSHA256,capabilitySHA256:handoff.capabilitySHA256});
  const verify=()=>{
   if(failure||!acceptingObservations||fs.existsSync(resultPath))throw Error('supervisor unavailable for coordinator control');
   if(digest(readBounded(path.join(c.cellDir,'assignment.json'),16384))!==assignmentSHA256||digest(readBounded(path.join(c.cellDir,'config.json'),16384))!==configSHA256||digest(readBounded(path.join(c.cellDir,'admission.json')))!==admissionSHA256)throw Error('coordinator control source binding changed');
   return verifyReadyLiveness({start:startEvidence,ready:readyEvidence},{now:clock.now});
  };
  const before=verify();observe('coordinator-control-start',{actorId:request.actorId,remainingMs:before.remainingMs});coordinatorControls++;
  await recordDispatchIntent({cellDir:c.cellDir,actorId:request.actorId,assignmentSHA256,handoffSHA256:request.handoffSHA256,capabilitySHA256:request.capabilitySHA256});
  const after=verify();if(JSON.stringify(verifyCellPublicHandoff({cellDir:c.cellDir}))!==JSON.stringify(handoff))throw Error('public handoff changed during intent');const intentSHA256=digest(readBounded(path.join(c.cellDir,'actor-dispatch-intent.json'),16384));
  const ack=JSON.stringify({kind:'coordinator-dispatch-intent-ack',actorId:request.actorId,assignmentSHA256,handoffSHA256:request.handoffSHA256,capabilitySHA256:request.capabilitySHA256,intentSHA256,observedMonotonicMs:after.observedMonotonicMs,remainingMs:after.remainingMs})+'\n';
  if(Buffer.byteLength(ack)>COORDINATOR_CONTROL_BYTES)throw Error('coordinator acknowledgement too large');
  coordinatorOutputBytes+=Buffer.byteLength(ack);await stdout(ack);verify();
  const acknowledged=observe('coordinator-control-ack',{actorId:request.actorId,assignmentSHA256,handoffSHA256:request.handoffSHA256,capabilitySHA256:request.capabilitySHA256,intentSHA256,bytes:Buffer.byteLength(ack)});if(acknowledged.monotonicMs>=deadline)throw Error('coordinator acknowledgement expired');acceptedHandoff=handoff;inputPhase='tools';
  if(inputEnded)child.stdin.end();else input.resume?.();
 };
 const onInput=chunk=>{
  if(clock.now()>=deadline)return fail('wall timeout; cleanup uncertain');
  if(inputPhase==='tools'){bytesIn+=Buffer.byteLength(chunk);if(bytesIn>BOUNDS.inputBytes)return fail('input overflow; cleanup uncertain');if(nativeAssignment&&!actorInputObserved){try{const checked=readCellBootstrapReceipt({cellDir:c.cellDir});if(JSON.stringify(checked.description)!==JSON.stringify(acceptedHandoff))throw Error('public handoff changed before actor input');if(clock.now()>=deadline)throw Error('assignment expired during public bootstrap verification');bootstrap={receiptSHA256:checked.receiptSHA256,attemptSHA256:checked.attemptSHA256,handoffSHA256:checked.description.handoffSHA256,capabilitySHA256:checked.description.capabilitySHA256,outputBytes:checked.receipt.emittedOutput.bytes,outputSHA256:checked.receipt.emittedOutput.sha256,scope:'helper emitted bytes; not proof of actor tool delivery or model consumption'};observe('bootstrap-emission-verified',{...bootstrap});observe('actor-input-start',{actorId:assignment.actorId,assignmentSHA256,bootstrapReceiptSHA256:checked.receiptSHA256,bytes:Buffer.byteLength(chunk),scope:'first actor-action stdin bytes after coordinator acknowledgement and bootstrap emission; authorship remains procedural'});actorInputObserved=true;}catch(error){return fail(`public bootstrap unavailable: ${error.message}; cleanup uncertain`);}}if(!child.stdin.write(chunk))input.pause?.();return;}
  coordinatorInputBytes+=Buffer.byteLength(chunk);if(coordinatorInputBytes>COORDINATOR_CONTROL_BYTES)return fail('coordinator control overflow; cleanup uncertain');
  if(inputPhase!=='awaiting-control')return fail('coordinator control before ready or while acknowledgement pending; cleanup uncertain');
  controlBuffer=Buffer.concat([controlBuffer,Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)]);
  const newline=controlBuffer.indexOf(10);if(newline<0)return;
  if(newline!==controlBuffer.length-1)return fail('pipelined data before coordinator acknowledgement; cleanup uncertain');
  inputPhase='control-pending';const frame=controlBuffer;controlBuffer=Buffer.alloc(0);
  controlPromise=performControl(frame).catch(error=>fail(`coordinator control failed: ${error.message}; cleanup uncertain`));
 };
 const onEnd=()=>{inputEnded=true;if(inputPhase==='tools')child.stdin.end();else if(inputPhase!=='control-pending')fail('EOF before coordinator acknowledgement; cleanup uncertain');};const onInputError=()=>fail('input error; cleanup uncertain');
 input.on('data',onInput);input.once('end',onEnd);input.once('error',onInputError);child.stdin.on('drain',()=>{if(inputPhase==='tools')input.resume?.();});child.stdin.on('error',()=>{});
 child.stdout.on('data',chunk=>{bytesOut+=chunk.length;if(bytesOut>BOUNDS.outputBytes)return fail('output overflow; cleanup uncertain');child.stdout.pause();outputQueue=outputQueue.then(()=>forwardOutput(chunk)).catch(()=>fail('output callback failed; cleanup uncertain')).finally(()=>child.stdout.resume());});
 child.stderr.on('data',chunk=>{bytesErr+=chunk.length;if(bytesErr>BOUNDS.stderrBytes)return fail('stderr overflow; cleanup uncertain');child.stderr.pause();errorQueue=errorQueue.then(()=>stderr(chunk)).catch(()=>fail('stderr callback failed; cleanup uncertain')).finally(()=>child.stderr.resume());});
 await new Promise(resolve=>{child.once('error',e=>{failure??=`spawn failed: ${e.message}`;resolve();});child.once('exit',(code,signal)=>{observe('worker-exit',{code,signal});exitCode=code;exitSignal=signal;resolve();});});
 let drainTimer;try{await Promise.race([closed.then(()=>Promise.all([outputQueue,errorQueue,controlPromise])),new Promise((_,reject)=>{drainTimer=clock.setTimeout(()=>reject(new Error('stdio drain uncertain')),Math.max(0,Math.min(2000,deadline-clock.now())));})]);}catch{failure??='stdio drain uncertain';}finally{clock.clearTimeout(drainTimer);}
 input.off('data',onInput);input.off('end',onEnd);input.off('error',onInputError);input.pause?.();child.stdin.destroy();
 // Sidecar owns separate groups: only its successful cooperative close can establish their normal cleanup.
 // After abnormal termination these groups cannot be exhaustively identified here; never accept that run.
 let groupAbsent=false,groupObservation,remainingGroup;
 try{if(child.pid){groupObservation=await awaitGroupExit(child.pid,Math.min(deadline,clock.now()+1000),{now:clock.now});groupAbsent=groupObservation.absent;if(groupObservation.observations.some(o=>o.group?.complete===false))failure??='group observation unavailable; cleanup uncertain';}else groupAbsent=true;
  if(!groupAbsent){remainingGroup=groupMembers(child.pid);failure??='remaining worker descendants; cleanup uncertain';kill();for(let i=0;i<40;i++){if(!aliveGroup(child.pid))break;await delay(25);}}
 }catch{failure??='cleanup check failed';kill();}
 clock.clearTimeout(timer);
 if(clock.now()>=deadline)failure??='wall timeout; cleanup uncertain';
 if(!groupAbsent)failure??='worker group persists; cleanup uncertain';
 child.stdout.destroy();child.stderr.destroy();
 let outcome;
 if(exitCode===0&&!exitSignal&&!failure){try{outcome=readSmallJson(path.join(c.cellDir,'worker-outcome.json'));if(outcome.status!=='submitted'||outcome.cleanupStatus!=='closed'||outcome.confirmedOutputBytes!==bytesOut)failure='worker incomplete or feedback not fully delivered';}catch(e){failure=`invalid worker outcome: ${e.message}`;}}
 else failure??='abnormal worker exit; cleanup uncertain';
 observe('supervisor-close');const ended=clock.now();acceptingObservations=false;
 if(ended>=deadline)failure??='wall timeout; cleanup uncertain';
 if(!readyObserved)failure??='ready packet not delivered';
 const timing={scope:'supervisor launch-to-close; includes loader, ready, input idle, relay, actions and cleanup',startedMonotonicMs:started,endedMonotonicMs:ended,elapsedMs:ended-started,startedAtUTC,assignmentLimitMs:BOUNDS.wallMs,observations};
 const result={timing,supervisorStartSHA256,configSHA256,admissionSHA256,groupObservation,remainingGroup,status:failure?'incomplete':'submitted',cleanup:failure?'uncertain':'closed',cleanupScope:'cooperative sidecar close and worker process group; not hostile-process containment',reason:failure,exitCode,exitSignal,bytesIn,bytesOut,bytesErr,coordinatorInputBytes,coordinatorOutputBytes,coordinatorControls,bootstrap,outcome};
 exclusive(resultPath,result);return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {if(process.argv.length!==3)throw new Error('usage: cli.mjs /absolute/cell-config.json');const c=readConfig(process.argv[2]);const result=await supervise(c);if(result.status==='submitted'){const {snapshotSubmission}=await import('./coordinator.mjs');const submission=await snapshotSubmission({cellDir:c.cellDir});await writeStream(process.stdout,JSON.stringify({kind:'final-submission',submission})+'\n');}else process.exitCode=1;}catch(e){try{await writeStream(process.stderr,JSON.stringify({kind:'supervisor-error',reason:String(e)})+'\n');}catch{}process.exitCode=1;}
}
