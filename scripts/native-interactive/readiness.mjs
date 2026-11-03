import fs from 'node:fs';
import {LIMITS,monotonicNow} from './protocol.mjs';

// Leaf module: never import the executable CLI or coordinator from readiness checks.
/** Read a small procfs record without trusting pseudo-file size metadata. */
function readProcText(file,max=8192){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const buffer=Buffer.alloc(max+1);let used=0;while(used<buffer.length){const n=fs.readSync(fd,buffer,used,buffer.length-used,null);if(!n)break;used+=n;}if(used>max)throw Error('oversized process observation');return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,used));}finally{fs.closeSync(fd);}
}
/** Parse Linux stat without assuming that its parenthesized command contains no spaces. */
function processStat(text,pid){
 const begin=text.indexOf('('),end=text.lastIndexOf(')'),fields=text.slice(end+2).trim().split(/\s+/);
 if(begin<0||end<=begin||Number(text.slice(0,begin).trim())!==pid||fields.length<20||!['R','S','D','I'].includes(fields[0])||!/^\d+$/.test(fields[1])||!/^\d+$/.test(fields[2])||!/^\d+$/.test(fields[19]))throw Error('unknown or non-live process observation');
 return {pid,parentPid:Number(fields[1]),processGroupId:Number(fields[2]),startTimeTicks:fields[19],state:fields[0]};
}
/** Observe a process in this Linux procfs view. Absence or unreadability is unknown, never proof
 * of a live process or successful cleanup. A missing time namespace remains explicitly unknown.
 */
export function readLinuxProcessIdentity(pid,{readText=readProcText,readlink=fs.readlinkSync}={}){
 if(process.platform!=='linux'||!Number.isSafeInteger(pid)||pid<=0)throw Error('unsupported process identity');
 const before=processStat(readText(`/proc/${pid}/stat`,8192),pid);
 const namespace=name=>{const value=readlink(`/proc/${pid}/ns/${name}`);if(typeof value!=='string'||!new RegExp(`^${name}:\\[\\d+\\]$`).test(value))throw Error('unknown process namespace');return value;};
 const pidNamespace=namespace('pid'),mountNamespace=namespace('mnt');let timeNamespace;
 try{timeNamespace=namespace('time');}catch(error){if(error.code!=='ENOENT')throw error;timeNamespace=null;}
 const bootId=readText('/proc/sys/kernel/random/boot_id',128).trim();if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(bootId))throw Error('unknown boot identity');
 const after=processStat(readText(`/proc/${pid}/stat`,8192),pid);
 if(before.startTimeTicks!==after.startTimeTicks||before.parentPid!==after.parentPid||before.processGroupId!==after.processGroupId)throw Error('process identity changed during observation');
 return {...after,pidNamespace,mountNamespace,timeNamespace,bootId};
}
/** Compare identity, not transient live scheduler state. */
export function identityKey(identity){
 if(!identity||!Number.isSafeInteger(identity.pid)||identity.pid<=0||!Number.isSafeInteger(identity.parentPid)||identity.parentPid<0||!Number.isSafeInteger(identity.processGroupId)||identity.processGroupId<0||!/^\d+$/.test(identity.startTimeTicks)||!['R','S','D','I'].includes(identity.state)||!/^pid:\[\d+\]$/.test(identity.pidNamespace)||!/^mnt:\[\d+\]$/.test(identity.mountNamespace)||!(identity.timeNamespace===null||/^time:\[\d+\]$/.test(identity.timeNamespace))||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(identity.bootId))throw Error('invalid process identity evidence');
 return JSON.stringify([identity.pid,identity.parentPid,identity.processGroupId,identity.startTimeTicks,identity.pidNamespace,identity.mountNamespace,identity.timeNamespace,identity.bootId]);
}
/** Recheck live identities and the original fixed deadline, without signals or side effects.
 * Same-process clocks are comparable. Other observers require a known matching time namespace.
 * The returned snapshot is not a lease: processes may exit immediately after this observation.
 */
export function verifyReadyLiveness({start,ready},{now=monotonicNow,readIdentity=readLinuxProcessIdentity,currentPID=process.pid}={}){
 if(start?.kind!=='supervisor-launch-observation'||ready?.kind!=='supervisor-ready-acknowledgement'||start.assignmentLimitMs!==LIMITS.assignmentMs||!Number.isFinite(start.startedMonotonicMs)||start.startedMonotonicMs<0||start.deadlineMonotonicMs!==start.startedMonotonicMs+LIMITS.assignmentMs||!Number.isFinite(ready.monotonicMs)||ready.monotonicMs<start.startedMonotonicMs||ready.monotonicMs>=start.deadlineMonotonicMs)throw Error('invalid readiness deadline evidence');
 const expectedSupervisor=ready.processes?.supervisor,expectedWorker=ready.processes?.worker;
 if(identityKey(start.supervisorIdentity)!==identityKey(expectedSupervisor))throw Error('supervisor identity binding mismatch');
 identityKey(expectedWorker);
 const observer=readIdentity(currentPID);identityKey(observer);
 for(const identity of [expectedSupervisor,expectedWorker])if(observer.bootId!==identity.bootId||observer.pidNamespace!==identity.pidNamespace||observer.mountNamespace!==identity.mountNamespace)throw Error('process observation namespace mismatch');
 const sameProcess=identityKey(observer)===identityKey(expectedSupervisor);
 if(!sameProcess&&(!observer.timeNamespace||observer.timeNamespace!==expectedSupervisor.timeNamespace||observer.timeNamespace!==expectedWorker.timeNamespace))throw Error('cross-process clock comparability unknown');
 if(expectedWorker.parentPid!==expectedSupervisor.pid||expectedWorker.processGroupId!==expectedWorker.pid)throw Error('worker process lineage mismatch');
 const supervisor=readIdentity(expectedSupervisor.pid),worker=readIdentity(expectedWorker.pid);
 if(identityKey(supervisor)!==identityKey(expectedSupervisor)||identityKey(worker)!==identityKey(expectedWorker))throw Error('process identity mismatch');
 const checked=now();if(!Number.isFinite(checked)||checked<ready.monotonicMs||checked>=start.deadlineMonotonicMs)throw Error('readiness expired or clock unavailable');
 return {status:'live',observedMonotonicMs:checked,observedAtUTC:new Date().toISOString(),deadlineMonotonicMs:start.deadlineMonotonicMs,remainingMs:start.deadlineMonotonicMs-checked,clockScope:sameProcess?'same supervisor process':'observed matching Linux time namespace',observer,supervisor,worker,scope:'same-namespace live identity snapshot; not a lease or proof of actor consumption'};
}

