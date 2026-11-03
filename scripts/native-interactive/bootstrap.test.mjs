import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {digest} from './protocol.mjs';
import {generatePublicHandoff, HANDOFF_LIMITS} from './handoff.mjs';
import {generateBootstrapCapability, generateBootstrapOutput, verifyBootstrapOutput, runPublicBootstrap, verifyBootstrapReceipt} from './bootstrap.mjs';

/** Retain synthetic fixture artifacts for diagnosis; never remove previous attempts. */
function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-public-bootstrap-')),cellDir=path.join(root,'cell-one');fs.mkdirSync(cellDir);
  const bindings={cellDir,cellId:'cell-one',cellIndex:0,fixtureId:'calendar-window',arm:'direct',campaignSHA256:digest('synthetic campaign'),sourceBindingSHA256:digest('source'),assignmentSHA256:digest('assignment'),admissionSHA256:digest('admission'),protocolSHA256:digest('protocol')};
  const task=Buffer.from('Fix café 🐢.\n'),readyFrame=Buffer.from('{ "kind":"ready", "packet":{"task":'+JSON.stringify(task.toString())+',"instructions":"Use tools.","tools":[],"allowedWritePaths":["fix.py","tests/test_regressions.py"],"fingerprint":{"promptHash":"a","toolsHash":"b"}} }\n');
  const {payload,manifest}=generatePublicHandoff({task,readyFrame,bindings}),manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  const cap=generateBootstrapCapability({cellDir,manifest,manifestBytes}),capabilityPath=path.join(cellDir,'public-bootstrap.json');
  fs.writeFileSync(path.join(cellDir,'public-handoff.txt'),payload,{flag:'wx'});fs.writeFileSync(path.join(cellDir,'public-handoff.json'),manifestBytes,{flag:'wx'});fs.writeFileSync(capabilityPath,cap.bytes,{flag:'wx'});
  const intent={assignmentSHA256:bindings.assignmentSHA256,handoff:{handoffSHA256:manifest.payload.sha256,capabilitySHA256:cap.sha256,manifestSHA256:digest(manifestBytes),bindings:manifest.bindings}};
  const intentBytes=Buffer.from(JSON.stringify(intent,null,2)+'\n');fs.writeFileSync(path.join(cellDir,'actor-dispatch-intent.json'),intentBytes,{flag:'wx'});
  return {root,cellDir,bindings,task,readyFrame,payload,manifest,dispatchIntentSHA256:digest(intentBytes),...cap,capabilityPath,expectedCapabilitySHA256:cap.sha256};
}
/** An explicit callback acknowledgement, not a claim about delivery to an actor. */
function ack(output) { return {bytes:output.length,sha256:digest(output)}; }
/** Read a test artifact after a completed helper operation. */
function artifact(f,name) { return JSON.parse(fs.readFileSync(path.join(f.cellDir,name))); }

test('one successful invocation reserves before emit and persists matching receipt after callback', async()=>{
  const f=fixture();let output,emitCount=0;
  const receipt=await runPublicBootstrap({...f,emit:async bytes=>{emitCount++;output=bytes;assert.equal(artifact(f,'public-bootstrap-attempt.json').status,'reserved');assert.equal(fs.existsSync(path.join(f.cellDir,'public-bootstrap-receipt.json')),false);return ack(bytes);}});
  assert.equal(emitCount,1);assert.equal(receipt.status,'emitted');assert.deepEqual(receipt,artifact(f,'public-bootstrap-receipt.json'));
  assert.deepEqual(verifyBootstrapOutput({output,...f,capabilitySHA256:f.sha256}),ack(output));
  assert.equal(receipt.emittedOutput.bytes,output.length);assert.equal(receipt.emittedPayload.bytes,f.payload.length);
  assert.equal(verifyBootstrapReceipt({receipt,...f,capabilitySHA256:f.sha256}),receipt);
  await assert.rejects(runPublicBootstrap({...f,emit:()=>{throw Error('must not emit again');}}),/already|EEXIST/);
});

test('full output framing detects truncation, reordering, extra suffix and missing final newline',()=>{
  const f=fixture(), output=generateBootstrapOutput({...f,capabilitySHA256:f.sha256});
  assert.deepEqual(verifyBootstrapOutput({...f,output,capabilitySHA256:f.sha256}),ack(output));
  const terminal=output.toString().split('\n').at(-2),match=/^PUBLIC_BOOTSTRAP_END v1 outputBytes=(\d+) bodyBytes=(\d+) bodySHA256=([a-f0-9]{64})$/.exec(terminal);
  assert.ok(match);assert.equal(Number(match[1]),output.length);assert.equal(match[3],digest(output.subarray(0,Number(match[2]))));
  for(const altered of [output.subarray(0,-1),output.subarray(0,100),Buffer.concat([output,Buffer.from('extra')]),Buffer.concat([output.subarray(1),output.subarray(0,1)])]) assert.throws(()=>verifyBootstrapOutput({...f,output:altered,capabilitySHA256:f.sha256}),/incomplete|changed/);
});

test('failed or incomplete emit creates failed receipt and makes the cell one-shot',async()=>{
  for(const emit of [()=>{throw Error('simulated broken pipe');},bytes=>({bytes:bytes.length-1,sha256:digest(bytes.subarray(0,-1))}),()=>undefined]){
    const f=fixture();await assert.rejects(runPublicBootstrap({...f,emit}),/emission failed/);
    const receipt=artifact(f,'public-bootstrap-receipt.json');assert.equal(receipt.status,'failed');assert.equal(receipt.emittedOutput,null);assert.equal(receipt.emittedPayload,null);
    assert.equal(artifact(f,'public-bootstrap-attempt.json').status,'reserved');
    await assert.rejects(runPublicBootstrap({...f,emit:ack}),/already|EEXIST/);
    assert.throws(()=>verifyBootstrapReceipt({receipt,...f,capabilitySHA256:f.sha256}));
  }
});

test('a pending emitter holds the exclusive reservation against concurrent invocation',async()=>{
  const f=fixture();let release;const pending=runPublicBootstrap({...f,emit:output=>new Promise(resolve=>{release=()=>resolve(ack(output));})});
  assert.equal(typeof release,'function');await assert.rejects(runPublicBootstrap({...f,emit:ack}),/EEXIST/);release();assert.equal((await pending).status,'emitted');
});

test('rejects wrong capability, changed payload and manifest before any output',async()=>{
  for(const [change,consumed] of [[f=>f.expectedCapabilitySHA256=digest('wrong'),false],[f=>fs.appendFileSync(path.join(f.cellDir,'public-handoff.txt'),'x'),true],[f=>fs.appendFileSync(path.join(f.cellDir,'public-handoff.json'),' '),true],[f=>fs.appendFileSync(f.capabilityPath,' '),false]]){
    const f=fixture();change(f);let emitted=false;await assert.rejects(runPublicBootstrap({...f,emit:()=>{emitted=true;}}));assert.equal(emitted,false);assert.equal(fs.existsSync(path.join(f.cellDir,'public-bootstrap-attempt.json')),consumed);if(consumed)assert.equal(artifact(f,'public-bootstrap-receipt.json').status,'failed');
  }
});

test('rejects symlinked files and noncanonical cell aliases without emitting',async()=>{
  for(const name of ['public-handoff.txt','public-handoff.json','public-bootstrap.json','actor-dispatch-intent.json']){
    const f=fixture(),target=path.join(f.cellDir,name),original=target+'.original';fs.renameSync(target,original);fs.symlinkSync(original,target);
    await assert.rejects(runPublicBootstrap({...f,emit:()=>{throw Error('unexpected output');}}),/noncanonical/);
  }
  const f=fixture(),alias=path.join(f.root,'alias');fs.symlinkSync(f.cellDir,alias);
  await assert.rejects(runPublicBootstrap({...f,capabilityPath:path.join(alias,'public-bootstrap.json'),emit:ack}),/noncanonical/);
  await assert.rejects(runPublicBootstrap({...f,capabilityPath:path.join(f.cellDir,'nested','..','public-bootstrap.json')+'/../public-bootstrap.json',emit:ack}));
});

test('rejects hardlinks, oversized files, nonregular files and capability-selected arbitrary targets',async()=>{
  const hard=fixture();fs.linkSync(path.join(hard.cellDir,'public-handoff.txt'),path.join(hard.root,'hardlink'));await assert.rejects(runPublicBootstrap({...hard,emit:ack}),/unsafe/);
  const big=fixture();fs.writeFileSync(path.join(big.cellDir,'public-handoff.txt'),Buffer.alloc(HANDOFF_LIMITS.payloadBytes+1));await assert.rejects(runPublicBootstrap({...big,emit:ack}),/oversized/);
  const dir=fixture(),file=path.join(dir.cellDir,'public-handoff.txt');fs.renameSync(file,file+'.original');fs.mkdirSync(file);await assert.rejects(runPublicBootstrap({...dir,emit:ack}),/unsafe/);
  const escape=fixture();escape.capability.handoffPath=path.join(escape.root,'secret');const bytes=Buffer.from(JSON.stringify(escape.capability,null,2)+'\n');fs.writeFileSync(escape.capabilityPath,bytes);escape.expectedCapabilitySHA256=digest(bytes);await assert.rejects(runPublicBootstrap({...escape,emit:ack}),/path escape/);
});

test('detects a file changing during its bounded read',async t=>{
  const f=fixture(),target=path.join(f.cellDir,'public-handoff.txt'),inode=fs.statSync(target).ino,original=fs.readSync;let changed=false;
  t.mock.method(fs,'readSync',function(fd,...args){const result=original.call(fs,fd,...args);if(fs.fstatSync(fd).ino===inode&&!changed){changed=true;fs.appendFileSync(target,'mutation');}return result;});
  await assert.rejects(runPublicBootstrap({...f,emit:ack}),/unstable/);assert.equal(changed,true);
});

test('receipt verifier rejects changed identity, counts, output and attempted lineage',async()=>{
  const f=fixture(),receipt=await runPublicBootstrap({...f,emit:ack});
  for(const change of [r=>r.emittedOutput.bytes++,r=>r.expectedOutput.sha256=digest('wrong'),r=>r.manifest.bindings.assignmentSHA256=digest('other'),r=>r.attemptSHA256=digest('wrong'),r=>r.capabilitySHA256=digest('wrong'),r=>r.extra='unexpected']){
    const altered=structuredClone(receipt);change(altered);assert.throws(()=>verifyBootstrapReceipt({...f,receipt:altered,capabilitySHA256:f.sha256}));
  }
});

test('fixed CLI emits complete exact output and rejects additional caller arguments',()=>{
  const f=fixture(),script=path.resolve(import.meta.dirname,'bootstrap.mjs');
  const bad=spawnSync(process.execPath,[script,f.capabilityPath,f.sha256,'arbitrary-file'],{maxBuffer:200000});assert.notEqual(bad.status,0);assert.equal(bad.stdout.length,0);assert.equal(fs.existsSync(path.join(f.cellDir,'public-bootstrap-attempt.json')),false);
  const result=spawnSync(process.execPath,[script,f.capabilityPath,f.sha256],{maxBuffer:200000});assert.equal(result.status,0,result.stderr.toString());assert.equal(result.stderr.length,0);assert.deepEqual(result.stdout,generateBootstrapOutput({...f,capabilitySHA256:f.sha256}));assert.equal(artifact(f,'public-bootstrap-receipt.json').status,'emitted');
});

 test('requires a matching fixed dispatch intent and consumes authenticated invalid attempts',async()=>{
  for(const change of [f=>fs.renameSync(path.join(f.cellDir,'actor-dispatch-intent.json'),path.join(f.cellDir,'intent.saved.json')),f=>{const name=path.join(f.cellDir,'actor-dispatch-intent.json'),intent=JSON.parse(fs.readFileSync(name));intent.handoff.capabilitySHA256=digest('wrong');fs.writeFileSync(name,JSON.stringify(intent)+'\n');}]){
    const f=fixture();change(f);await assert.rejects(runPublicBootstrap({...f,emit:()=>{throw Error('unexpected output');}}));assert.equal(fs.existsSync(path.join(f.cellDir,'public-bootstrap-attempt.json')),true);assert.equal(artifact(f,'public-bootstrap-receipt.json').status,'failed');
  }
 });

 test('rejects noncanonical capability serialization and preexisting dangling receipt links',async()=>{
  const f=fixture(),bytes=Buffer.from(JSON.stringify(f.capability)+'\n');fs.writeFileSync(f.capabilityPath,bytes);f.expectedCapabilitySHA256=digest(bytes);await assert.rejects(runPublicBootstrap({...f,emit:ack}),/noncanonical capability/);
  const linked=fixture();fs.symlinkSync(path.join(linked.root,'absent'),path.join(linked.cellDir,'public-bootstrap-receipt.json'));await assert.rejects(runPublicBootstrap({...linked,emit:ack}),/already has a receipt/);assert.equal(fs.existsSync(path.join(linked.cellDir,'public-bootstrap-attempt.json')),true);
 });

/** Drive trusted local time without sleeping or changing the production timeout constant. */
function controlledClock() {
  let time=0, next=1;const timers=new Map(),delays=[];
  return {delays,now:()=>time,setTimeout(fn,delay){const id=next++;timers.set(id,{fn,end:time+delay});delays.push(delay);return id;},clearTimeout(id){timers.delete(id);},setTime(value,fire=true){time=value;if(fire)for(const [id,timer]of [...timers])if(timer.end<=time){timers.delete(id);timer.fn();}},pending:()=>timers.size};
}

test('hanging output has a fixed 60000 ms local limit, aborts, and cannot succeed late',async()=>{
  const f=fixture(),clock=controlledClock();let release,signal;
  const pending=runPublicBootstrap({...f,clock,emit:(output,options)=>{signal=options.signal;return new Promise(resolve=>{release=()=>resolve(ack(output));});}});
  const rejected=assert.rejects(pending,/emission failed/);
  assert.deepEqual(clock.delays,[60000]);assert.equal(signal.aborted,false);
  clock.setTime(59999);await Promise.resolve();assert.equal(fs.existsSync(path.join(f.cellDir,'public-bootstrap-receipt.json')),false);
  clock.setTime(60000);await rejected;assert.equal(signal.aborted,true);assert.equal(clock.pending(),0);
  const receiptPath=path.join(f.cellDir,'public-bootstrap-receipt.json'),before=fs.readFileSync(receiptPath);
  assert.equal(JSON.parse(before).status,'failed');assert.match(JSON.parse(before).reason,/local emission timeout/);
  release();await Promise.resolve();await Promise.resolve();assert.deepEqual(fs.readFileSync(receiptPath),before);
  await assert.rejects(runPublicBootstrap({...f,emit:ack}),/already|EEXIST/);
});

test('local deadline includes pre-emission work and expired setup never invokes emitter',async()=>{
  for(const setupMs of [2500,60000]){
    const f=fixture(),clock=controlledClock();let reads=0,emitted=false;
    const now=()=>{if(reads++===1)clock.setTime(setupMs,false);return clock.now();};
    const pending=runPublicBootstrap({...f,clock:{...clock,now},emit:()=>{emitted=true;return new Promise(()=>{});}}),rejected=assert.rejects(pending,/emission failed/);
    if(setupMs<60000){assert.equal(emitted,true);assert.deepEqual(clock.delays,[60000-setupMs]);clock.setTime(60000);}
    else{assert.equal(emitted,false);assert.deepEqual(clock.delays,[]);}
    await rejected;assert.equal(artifact(f,'public-bootstrap-attempt.json').status,'reserved');assert.equal(artifact(f,'public-bootstrap-receipt.json').status,'failed');
  }
});

test('acknowledgement at the local deadline fails even if its timer has not fired',async()=>{
  const f=fixture(),clock=controlledClock();let release;
  const pending=runPublicBootstrap({...f,clock,emit:output=>new Promise(resolve=>{release=()=>resolve(ack(output));})}),rejected=assert.rejects(pending,/emission failed/);
  clock.setTime(60000,false);release();await rejected;
  assert.equal(artifact(f,'public-bootstrap-receipt.json').status,'failed');assert.equal(clock.pending(),0);
});

test('rejected asynchronous output clears the local timer and retains a failed reservation',async()=>{
  const f=fixture(),clock=controlledClock();await assert.rejects(runPublicBootstrap({...f,clock,emit:()=>Promise.reject(Error('asynchronous output failure'))}),/emission failed/);
  assert.deepEqual(clock.delays,[60000]);assert.equal(clock.pending(),0);assert.equal(artifact(f,'public-bootstrap-attempt.json').status,'reserved');assert.match(artifact(f,'public-bootstrap-receipt.json').reason,/asynchronous output failure/);
});

test('production emitter aborts only its own stdout stream on the fixed local timeout',()=>{
  const f=fixture(),moduleURL=new URL('./bootstrap.mjs',import.meta.url).href;
  const script=`
    import fs from 'node:fs';
    import {runPublicBootstrap} from ${JSON.stringify(moduleURL)};
    let time=0,timer,callback,destroyed=false;
    const clock={now:()=>time,setTimeout(fn,delay){if(delay!==60000)throw Error('wrong fixed deadline');timer=fn;return 1;},clearTimeout(){}};
    process.stdout.write=(output,done)=>{callback=done;return false;};
    process.stdout.destroy=error=>{destroyed=true;queueMicrotask(()=>process.stdout.emit('error',error));return process.stdout;};
    const pending=runPublicBootstrap({capabilityPath:${JSON.stringify(f.capabilityPath)},expectedCapabilitySHA256:${JSON.stringify(f.sha256)},clock});
    if(typeof callback!=='function')throw Error('production emitter did not write');
    time=60000;timer();
    try{await pending;throw Error('unexpected success');}catch(error){if(!error.message.includes('emission failed'))throw error;}
    if(!destroyed)throw Error('own stdout was not destroyed');
    const receiptPath=${JSON.stringify(path.join(f.cellDir,'public-bootstrap-receipt.json'))},before=fs.readFileSync(receiptPath);
    if(JSON.parse(before).status!=='failed')throw Error('missing failed receipt');
    callback();await Promise.resolve();if(!fs.readFileSync(receiptPath).equals(before))throw Error('late callback changed receipt');
    process.stderr.write('production abort control passed');
  `;
  const result=spawnSync(process.execPath,['--input-type=module','--eval',script],{timeout:5000,maxBuffer:20000});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr.toString());assert.equal(result.stdout.length,0);assert.match(result.stderr.toString(),/production abort control passed/);
});

test('authenticated payload failure is reserved before reading and cannot be retried after repair',async t=>{
  const f=fixture(),manifestPath=path.join(f.cellDir,'public-handoff.json'),manifestInode=fs.statSync(manifestPath).ino,original=fs.readSync;let reservedBeforeRead=false;
  t.mock.method(fs,'readSync',function(fd,...args){if(fs.fstatSync(fd).ino===manifestInode){reservedBeforeRead=fs.existsSync(path.join(f.cellDir,'public-bootstrap-attempt.json'));}return original.call(fs,fd,...args);});
  fs.appendFileSync(path.join(f.cellDir,'public-handoff.txt'),'tamper');
  await assert.rejects(runPublicBootstrap({...f,emit:()=>{throw Error('must not emit');}}),/validation or emission failed/);
  assert.equal(reservedBeforeRead,true);const receiptBefore=fs.readFileSync(path.join(f.cellDir,'public-bootstrap-receipt.json'));assert.equal(JSON.parse(receiptBefore).status,'failed');
  fs.writeFileSync(path.join(f.cellDir,'public-handoff.txt'),f.payload);
  await assert.rejects(runPublicBootstrap({...f,emit:ack}),/EEXIST/);assert.deepEqual(fs.readFileSync(path.join(f.cellDir,'public-bootstrap-receipt.json')),receiptBefore);
});
