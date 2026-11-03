import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {captureActorData,actorDataCommand,actorDataPaths,verifyCapturedActorData,ACTOR_DATA_LIMITS,ACTOR_DATA_READY} from './actor-data.mjs';
import {digest,LIMITS} from './protocol.mjs';

/** All synthetic evidence is retained; these tests never start a model or project tool. */
function fixture(){return fs.mkdtempSync(path.join(os.tmpdir(),'actor-data-control-'));}
const action=value=>Buffer.from(JSON.stringify({kind:'tools',sequence:1,calls:[{name:'writeFile',args:{path:'a.py',content:value}}]})+'\n');
const ack=bytes=>({bytes:bytes.length,sha256:digest(bytes)});
async function capture(raw,options={}){
 const cellDir=options.cellDir??fixture(),input=new PassThrough();
 const promise=captureActorData({cellDir,arm:'direct',sequence:1,input,emit:ack,...options});
 input.end(raw);const receipt=await promise;
 return {cellDir,receipt,files:actorDataPaths(cellDir,1)};
}
function clock(){let time=0,id=0;const timers=new Map();return {now:()=>time,setTimeout(fn,ms){const k=++id;timers.set(k,{fn,at:time+ms});return k;},clearTimeout(k){timers.delete(k);},advance(ms){time+=ms;for(const [k,t]of [...timers])if(t.at<=time){timers.delete(k);t.fn();}},jump(ms){time+=ms;},pending:()=>timers.size};}
async function flush(){for(let i=0;i<15;i++)await Promise.resolve();}

test('hostile shell characters are exact inert bytes, with no marker execution',async()=>{
 const cellDir=fixture(),marker=path.join(cellDir,'MUST_NOT_EXIST');
 const hostile="`touch "+marker+"` $(touch "+marker+") '; touch "+marker+"; # \" \\ ${HOME}\r\n🐢\u0000";
 const raw=action(hostile),r=await capture(raw,{cellDir});
 assert.deepEqual(fs.readFileSync(r.files.input),raw);assert.equal(fs.existsSync(marker),false);
 assert.equal(r.receipt.inputSHA256,digest(raw));assert.deepEqual(verifyCapturedActorData({cellDir,arm:'direct',sequence:1,raw}),r.receipt);
});
test('fixed command never contains actor text and rejects unsafe coordinator paths',()=>{
 const cellDir=fixture(),command=actorDataCommand({cellDir,arm:'direct',sequence:1});
 assert.ok(command.endsWith(cellDir+' direct 1'));assert.doesNotMatch(command,/[`$;"'\n]/);
 assert.throws(()=>actorDataCommand({cellDir,arm:'direct;bad',sequence:1}));
 assert.throws(()=>actorDataCommand({cellDir,arm:'direct',sequence:1,node:'/tmp/node;bad'}));
 const unsafe=path.join(cellDir,'bad;name');fs.mkdirSync(unsafe);assert.throws(()=>actorDataCommand({cellDir:unsafe,arm:'direct',sequence:1}));
});
test('maximum 98,305-byte frame is exact; one byte more fails without receipt',async()=>{
 const initial=action(''),raw=action('x'.repeat(ACTOR_DATA_LIMITS.inputBytes-initial.length));
 assert.equal(raw.length,98305);const r=await capture(raw);assert.deepEqual(fs.readFileSync(r.files.input),raw);
 const cellDir=fixture();await assert.rejects(capture(Buffer.concat([raw.subarray(0,-1),Buffer.from(' \n')]),{cellDir}),/input limit/);
 assert.equal(fs.existsSync(actorDataPaths(cellDir,1).receipt),false);
});
test('split UTF-8, CRLF and escaped lone surrogate retain exact original bytes',async()=>{
 for(const raw of [action('🐢 café'),Buffer.from(action('x').toString().replace(/\n$/,'\r\n')),action('\ud800')]){
  const cellDir=fixture(),input=new PassThrough(),p=captureActorData({cellDir,arm:'direct',sequence:1,input,emit:ack});
  for(const byte of raw)input.write(Buffer.from([byte]));input.end();await p;
  assert.deepEqual(fs.readFileSync(actorDataPaths(cellDir,1).input),raw);
 }
});
test('malformed UTF-8, BOM, NUL, extra frame, wrong sequence and EOF fail closed',async()=>{
 for(const raw of [Buffer.from([0xff,10]),Buffer.concat([Buffer.from([239,187,191]),action('x')]),Buffer.from('\0\n'),Buffer.concat([action('x'),action('y')]),Buffer.from('{"kind":"submit","sequence":2}\n'),action('x').subarray(0,-1)]){
  const cellDir=fixture();await assert.rejects(capture(raw,{cellDir}));
  assert.equal(fs.existsSync(actorDataPaths(cellDir,1).receipt),false);
  assert.throws(()=>verifyCapturedActorData({cellDir,arm:'direct',sequence:1,raw}));
 }
});
test('idle deadline retains attempt and partial data; replay cannot overwrite it',async()=>{
 const cellDir=fixture(),input=new PassThrough(),c=clock(),p=captureActorData({cellDir,arm:'direct',sequence:1,input,emit:ack,clock:c});
 const rejected=assert.rejects(p,/deadline/);input.write(Buffer.from('{'));c.advance(60000);await rejected;
 const files=actorDataPaths(cellDir,1);assert.equal(fs.readFileSync(files.input,'utf8'),'{');assert.equal(fs.existsSync(files.receipt),false);
 await assert.rejects(capture(action('retry'),{cellDir}),/already attempted/);assert.equal(c.pending(),0);
});
test('output rejection, incomplete ack and hanging output never admit relay',async()=>{
 for(const emit of [()=>{throw Error('broken pipe');},()=>({bytes:1,sha256:digest('wrong')})]){
  const cellDir=fixture();await assert.rejects(capture(action('x'),{cellDir,emit}));assert.equal(fs.existsSync(actorDataPaths(cellDir,1).receipt),false);
 }
 const cellDir=fixture(),c=clock();let late;
 const p=capture(action('x'),{cellDir,clock:c,emit:()=>new Promise(resolve=>{late=resolve;})});const rejected=assert.rejects(p,/deadline/);
 await flush();c.advance(60000);await rejected;late(ack(Buffer.from('ignored')));await flush();
 assert.equal(fs.existsSync(actorDataPaths(cellDir,1).receipt),false);assert.equal(c.pending(),0);
});
test('readiness acknowledgement is bounded by the same deadline and precedes receipt',async()=>{
 const cellDir=fixture(),input=new PassThrough(),c=clock();let release;
 const p=captureActorData({cellDir,arm:'direct',sequence:1,input,emit:ack,onReady:()=>new Promise(resolve=>{release=resolve;}),clock:c});
 const rejected=assert.rejects(p,/deadline/);await flush();c.advance(60000);await rejected;
 release(ack(ACTOR_DATA_READY));await flush();assert.equal(fs.existsSync(actorDataPaths(cellDir,1).receipt),false);assert.equal(c.pending(),0);
 const order=[];await capture(action('x'),{onReady:bytes=>{assert.deepEqual(bytes,ACTOR_DATA_READY);order.push('ready');return ack(bytes);},emit:bytes=>{order.push('receipt');return ack(bytes);}});
 assert.deepEqual(order,['ready','receipt']);
});
test('exact-deadline output acknowledgement and cancellation are rejected',async()=>{
 const c=clock(),cellDir=fixture();await assert.rejects(capture(action('x'),{cellDir,clock:c,emit:bytes=>{c.jump(60000);return ack(bytes);}}),/deadline/);
 const controller=new AbortController();controller.abort();await assert.rejects(capture(action('x'),{signal:controller.signal}),/cancelled/);
 assert.equal(fs.existsSync(actorDataPaths(cellDir,1).receipt),false);
});
test('late extra data or stream error during output acknowledgement invalidates capture',async()=>{
 for(const mode of ['extra','error']){
  const cellDir=fixture(),input=new PassThrough();let release;
  const p=captureActorData({cellDir,arm:'direct',sequence:1,input,emit:bytes=>new Promise(resolve=>{release=()=>resolve(ack(bytes));})});
  const rejected=assert.rejects(p,/after frame|input error/);input.write(action('x'));await flush();
  if(mode==='extra')input.write(Buffer.from('extra bytes\n'));else input.emit('error',Error('synthetic input error'));
  await rejected;release();await flush();
  assert.equal(fs.existsSync(actorDataPaths(cellDir,1).receipt),false);
  assert.throws(()=>verifyCapturedActorData({cellDir,arm:'direct',sequence:1,raw:action('x')}));
 }
});
test('receipt gate rejects modified bytes, forged metadata, missing receipt and links',async()=>{
 const raw=action('x'),r=await capture(raw);
 assert.throws(()=>verifyCapturedActorData({cellDir:r.cellDir,arm:'direct',sequence:1,raw:action('y')}),/mismatch/);
 const original=fs.readFileSync(r.files.receipt);fs.writeFileSync(r.files.receipt,original.toString().replace('direct','branch-expanded'));
 assert.throws(()=>verifyCapturedActorData({cellDir:r.cellDir,arm:'direct',sequence:1,raw}),/mismatch/);
 const missing=fixture();assert.throws(()=>verifyCapturedActorData({cellDir:missing,arm:'direct',sequence:1,raw}));
 const linked=fixture();fs.symlinkSync(r.cellDir,path.join(linked,'alias'));assert.throws(()=>actorDataPaths(path.join(linked,'alias'),1),/noncanonical/);
});
test('real CLI uses pipe data only, exits normally, emits bounded metadata, and preserves bytes',async()=>{
 const cellDir=fixture(),raw=action('`echo never` $(printf never) 🐢'),script=path.resolve(import.meta.dirname,'actor-data.mjs');
 const child=spawn(process.execPath,[script,cellDir,'direct','1'],{stdio:['pipe','pipe','pipe'],env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin'}});
 const out=[],err=[];child.stdout.on('data',x=>out.push(x));child.stderr.on('data',x=>err.push(x));
 const ready=new Promise(resolve=>{child.stdout.on('data',()=>{if(Buffer.concat(out).subarray(0,ACTOR_DATA_READY.length).equals(ACTOR_DATA_READY))resolve();});});
 await ready;child.stdin.end(raw);const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 assert.equal(code,0,Buffer.concat(err).toString());assert.equal(Buffer.concat(err).length,0);assert.ok(Buffer.concat(out).length<=ACTOR_DATA_LIMITS.outputBytes);
 assert.equal(JSON.parse(Buffer.concat(out).subarray(ACTOR_DATA_READY.length)).inputSHA256,digest(raw));assert.deepEqual(fs.readFileSync(actorDataPaths(cellDir,1).input),raw);
});
test('native supervisor source binds capture verification before worker forwarding',()=>{
 const source=fs.readFileSync(path.resolve(import.meta.dirname,'cli.mjs'),'utf8');
 assert.ok(source.includes("import {verifyCapturedActorData} from './actor-data.mjs'"));
 assert.ok(source.includes('verifyCapturedActorData({cellDir:c.cellDir,arm:c.arm,sequence:actionTracker.snapshot.receivedCount,raw});assertReceiptActive();}if(!child.stdin.write(raw,'));
});
