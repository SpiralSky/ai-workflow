import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';
import {runCell} from './controller.mjs';
function input(lines){return Readable.from(lines.map(x=>JSON.stringify(x)+'\n'));}
const submit={sequence:2,kind:'submit'},action={sequence:1,kind:'tools',calls:[{name:'readFile',args:{path:'a.py'}}]};
test('synthetic protocol control reserves before effects and counts ready only once',async()=>{
 const records=[],out=[];let effects=0,closed=0;
 const result=await runCell({arm:'direct',input:input([action,submit]),emit:s=>out.push(s),journal:{append:e=>records.push(e)},createSession:async hooks=>({packet:{tools:[]},async dispatch(a){assert.equal(records.at(-2).type,'reserved');assert.equal(records.at(-1).type,'action-start');hooks.onHostAttempt('readFile',{});assert.equal(records.at(-1).type,'host-attempt');effects++;return ['ok'];},async close(){closed++;}}),onSubmit:async()=>({hash:'fixture'})});
 assert.equal(result.status,'submitted');assert.equal(effects,1);assert.ok(closed>=1);assert.equal(result.initialBytes,Buffer.byteLength(out[0]));assert.equal(result.visibleFeedbackBytes,Buffer.byteLength(out.slice(1).join('')));
});
test('journal reservation failure executes no tool effects',async()=>{
 let effects=0;const result=await runCell({arm:'direct',input:input([action]),emit(){},journal:{append(e){if(e.type==='reserved')throw new Error('disk');}},createSession:async()=>({packet:{},async dispatch(){effects++;},async close(){}}),onSubmit:async()=>({})});
 assert.equal(result.status,'incomplete');assert.equal(effects,0);
});
test('EOF without submit is incomplete, no independent grade manufactured',async()=>{
 let grades=0;const result=await runCell({arm:'direct',input:input([]),emit(){},journal:{append(){}},createSession:async()=>({packet:{},async close(){}}),onSubmit:async()=>{grades++;}});
 assert.equal(result.status,'incomplete');assert.equal(grades,0);
});
test('cleanup rejection remains explicit incomplete and is not retried',async()=>{
 let closes=0,submits=0;const result=await runCell({arm:'direct',input:input([{sequence:1,kind:'submit'}]),emit(){},journal:{append(){}},createSession:async()=>({packet:{},async close(){closes++;throw new Error('cleanup');}}),onSubmit:async()=>{submits++;}});
 assert.equal(result.status,'incomplete');assert.equal(result.reason,'cleanup uncertain');assert.equal(closes,1);assert.equal(submits,0);
});
test('async delivery rejection stops before effects and journals attempted bytes and terminal',async()=>{
 const records=[];let effects=0;
 const result=await runCell({arm:'direct',input:input([action]),emit:async()=>{throw Error('delivery')},journal:{append:e=>records.push(e)},createSession:async()=>({packet:{},async dispatch(){effects++},async close(){}}),onSubmit:async()=>({})});
 assert.equal(effects,0);assert.equal(result.status,'incomplete');assert.ok(result.initialBytes>0);assert.equal(result.confirmedOutputBytes,0);assert.equal(records.at(-1).type,'terminal');assert.equal(records.at(-1).outcome.cleanupStatus,'closed');
});
test('terminal journal failure cannot report submission success',async()=>{
 const result=await runCell({arm:'direct',input:input([{sequence:1,kind:'submit'}]),emit(){},journal:{append:e=>{if(e.type==='terminal')throw Error('disk')}},createSession:async()=>({packet:{},async close(){}}),onSubmit:async()=>({})});
 assert.equal(result.status,'incomplete');assert.equal(result.reason,'terminal journal failure');
});

/** Deterministic scheduler; budget values stay fixed while elapsed time is simulated. */
function fakeClock() {
 let time=0,id=0;const timers=new Map();
 return {now:()=>time,setTimeout(fn,ms){const key=++id;timers.set(key,{fn,at:time+ms});return key;},clearTimeout(key){timers.delete(key);},
  advance(ms){time+=ms;for(const [key,t] of [...timers])if(t.at<=time){timers.delete(key);t.fn();}},
  jump(ms){time+=ms;},pending:()=>timers.size};
}
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
function synthetic(overrides={}) {return {arm:'direct',input:input([{kind:'submit',sequence:1}]),emit(){},journal:{append(){}},createSession:async()=>({packet:{},async dispatch(){return ['ok'];},async close(){}}),onSubmit:async()=>({provisional:true}),...overrides};}

test('fixed limits reserve the twelfth round for submit',async()=>{
 const {LIMITS}=await import('./protocol.mjs');assert.equal(LIMITS.assignmentMs,900000);assert.equal(LIMITS.actionMs,300000);assert.equal(LIMITS.hostCalls,60);
 let effects=0;const createSession=async()=>({packet:{},async dispatch(){effects++;return ['ok'];},async close(){}});
 const actions=Array.from({length:11},(_,i)=>({...action,sequence:i+1}));
 const valid=await runCell(synthetic({input:input([...actions,{kind:'submit',sequence:12}]),createSession}));assert.equal(valid.status,'submitted');assert.equal(effects,11);
 effects=0;const bad=await runCell(synthetic({input:input([...actions,{...action,sequence:12}]),createSession}));assert.equal(bad.status,'incomplete');assert.match(bad.reason,/reserved for submit/);assert.equal(effects,11);
});

test('stdin idle is charged to fixed assignment ceiling without a native actor',async()=>{
 const clock=fakeClock(),records=[];let closes=0,effects=0;const waiting={async *[Symbol.asyncIterator](){await new Promise(()=>{});}};
 const running=runCell(synthetic({clock,input:waiting,journal:{append:e=>records.push(e)},createSession:async()=>({packet:{},async dispatch(){effects++},async close(){closes++;}})}));
 await flush();clock.advance(900000);await flush();const result=await running;
 assert.equal(result.status,'incomplete');assert.equal(effects,0);assert.equal(closes,1);assert.equal(result.timing.inputWaitMs,900000);assert.equal(result.cleanupStatus,'uncertain');assert.equal(clock.pending(),0);
 assert.ok(records.find(e=>e.type==='failure').reason.includes('assignment timeout'));
});

test('action deadline aborts the actual dispatch signal and late success cannot submit',async()=>{
 const clock=fakeClock(),records=[];let resolveAction,signal,closes=0,submits=0;
 const running=runCell(synthetic({clock,input:input([action,submit]),journal:{append:e=>records.push(e)},createSession:async()=>({packet:{},dispatch(a,s){signal=s;return new Promise(r=>{resolveAction=r;});},async close(){closes++;}}),onSubmit:async()=>{submits++;}}));
 await flush();assert.ok(signal instanceof AbortSignal);assert.equal(signal.aborted,false);clock.advance(300000);await flush();const result=await running;
 assert.equal(signal.aborted,true);assert.equal(result.status,'incomplete');assert.match(result.reason,/action timeout/);assert.equal(closes,1);assert.equal(submits,0);assert.equal(result.timing.phasesMs.action,300000);
 const count=records.length;resolveAction(['late success']);await flush();assert.equal(records.length,count);assert.equal(records.at(-1).type,'terminal');assert.equal(clock.pending(),0);
});

test('remaining assignment time takes precedence over the per-action allowance',async()=>{
 const clock=fakeClock();let send,signal;const waiting={async *[Symbol.asyncIterator](){yield await new Promise(r=>{send=r});}};
 const running=runCell(synthetic({clock,input:waiting,createSession:async()=>({packet:{},dispatch(a,s){signal=s;return new Promise(()=>{});},async close(){}})}));
 await flush();clock.advance(890000);send(JSON.stringify(action)+'\n');await flush();assert.equal(signal.aborted,false);clock.advance(10000);await flush();const result=await running;
 assert.equal(signal.aborted,true);assert.equal(result.status,'incomplete');assert.equal(result.timing.phasesMs.action,10000);assert.equal(result.timing.inputWaitMs,890000);
});

test('a returned action at the exact deadline is incomplete even before its timer runs',async()=>{
 const clock=fakeClock();let signal,submits=0;
 const result=await runCell(synthetic({clock,input:input([action,submit]),createSession:async()=>({packet:{},async dispatch(a,s){signal=s;clock.jump(300000);return ['too late'];},async close(){}}),onSubmit:async()=>{submits++;}}));
 assert.equal(result.status,'incomplete');assert.equal(signal.aborted,true);assert.equal(submits,0);assert.equal(clock.pending(),0);
});

test('unresolved cleanup is finite, uncertain and invoked only once',async()=>{
 const clock=fakeClock();let closes=0,submits=0;
 const running=runCell(synthetic({clock,createSession:async()=>({packet:{},close(){closes++;return new Promise(()=>{});}}),onSubmit:async()=>{submits++;}}));
 await flush();clock.advance(60000);await flush();const result=await running;
 assert.equal(result.status,'incomplete');assert.equal(result.reason,'cleanup uncertain');assert.equal(result.cleanupStatus,'uncertain');assert.equal(closes,1);assert.equal(submits,0);assert.equal(clock.pending(),0);
});

test('observations partition measured worker active and input-wait time without native attribution',async()=>{
 const clock=fakeClock(),records=[];let send;const waiting={async *[Symbol.asyncIterator](){yield await new Promise(r=>{send=r});yield JSON.stringify(submit)+'\n';}};
 const running=runCell(synthetic({clock,input:waiting,journal:{append:e=>records.push(e)},emit(){clock.jump(2)},createSession:async()=>{clock.jump(3);return {packet:{},async dispatch(){clock.jump(5);return ['ok'];},async close(){clock.jump(7)}};},onSubmit:async()=>{clock.jump(11);return {};}}));
 await flush();clock.advance(13);send(JSON.stringify(action)+'\n');const result=await running;
 assert.equal(result.status,'submitted');assert.equal(result.timing.elapsedMs,45);assert.equal(result.timing.inputWaitMs,13);assert.equal(result.timing.helperActiveMs,32);assert.equal(Object.values(result.timing.phasesMs).reduce((sum,n)=>sum+n,0),45);
 for(const kind of ['worker-start','ready','action-start','action-end','emission-attempt','emission-ack','submit-received','close-start','close-end'])assert.ok(records.some(e=>e.type===kind),kind);
 assert.ok(records.every((e,i)=>i===0||e.monotonicMs>=records[i-1].monotonicMs));
});

test('late initialization is never clean and its eventual resources receive one close',async()=>{
 const clock=fakeClock();let resolveSession,closes=0;const records=[];
 const running=runCell(synthetic({clock,journal:{append:e=>records.push(e)},createSession:()=>new Promise(r=>{resolveSession=r})}));
 await flush();clock.advance(900000);await flush();const result=await running;
 assert.equal(result.status,'incomplete');assert.equal(result.cleanupStatus,'uncertain');assert.equal(closes,0);
 const count=records.length;resolveSession({packet:{},async close(){closes++;}});await flush();assert.equal(closes,1);assert.equal(records.length,count);assert.equal(clock.pending(),0);
});

test('a failed public test is ordinary feedback until submission',async()=>{
 const result=await runCell(synthetic({input:input([action,submit]),createSession:async()=>({packet:{},async dispatch(){return [{text:JSON.stringify({passed:1,failed:1}),isError:false}]},async close(){}})}));
 assert.equal(result.status,'submitted');
});

test('failed cleanup observation does not suppress cooperative resource close',async()=>{
 let closes=0;const result=await runCell(synthetic({input:input([action]),journal:{append(e){if(['reserved','close-start','close-end'].includes(e.type))throw Error('journal unavailable');}},createSession:async()=>({packet:{},async close(){closes++;}})}));
 assert.equal(result.status,'incomplete');assert.equal(result.cleanupStatus,'uncertain');assert.equal(closes,1);
});

for(const arm of ['orchestrate-off','orchestrate-on'])for(const elapsed of [60001,299999])test(`whole action succeeds before the new ceiling (${arm}, ${elapsed}ms)`,async()=>{
 const clock=fakeClock(),doAction={sequence:1,kind:'do',args:{instruction:'Synthetic timing control'}};
 const result=await runCell(synthetic({arm,clock,input:input([doAction,submit]),createSession:async()=>({packet:{},async dispatch(){clock.jump(elapsed);return ['synthetic success'];},async close(){}})}));
 assert.equal(result.status,'submitted');assert.equal(result.timing.phasesMs.action,elapsed);assert.equal(clock.pending(),0);
});

test('late action at max+1 is incomplete and cancels before any submission',async()=>{
 const clock=fakeClock();let signal,submits=0;
 const result=await runCell(synthetic({clock,input:input([action,submit]),createSession:async()=>({packet:{},async dispatch(a,s){signal=s;clock.jump(300001);return ['late'];},async close(){}}),onSubmit(){submits++;}}));
 assert.equal(result.status,'incomplete');assert.equal(signal.aborted,true);assert.equal(submits,0);
});
