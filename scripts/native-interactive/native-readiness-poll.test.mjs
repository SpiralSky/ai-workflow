import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {completionTransportProgram,completionTransportRelayProgram} from './native-completion-transport-orchestration.mjs';

const ready='{"kind":"native-transport-observer-ready","version":1}\n';
const captureReady='{"kind":"native-completion-capture-ready","version":"native-completion-capture-stdin-v1"}\n';
const verdict='{"kind":"native-transport-verified","version":1}\n';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const options={cellDir:fs.mkdtempSync(path.join(process.env.NATIVE_TEST_EVIDENCE??'/tmp','readiness-poll-inert-')),sequence:1,supervisorSessionId:9001};
/** Inert tools retain every call and return raw chunks; never launch a child or actor. */
function harness({emptyPolls=0,invalid,throwPoll=false}={}){
 const state=new Map(),calls=[],sessions=new Map();let id=100,failed=0;
 const live=(output,session_id)=>({output,session_id,wall_time_seconds:0});
 const terminal=output=>({output,exit_code:0,wall_time_seconds:0});
 const h={state,calls,get failed(){return failed;},store:(k,v)=>state.set(k,v),load:k=>state.get(k),text:()=>{}};
 h.tools={async exec_command(a){calls.push({tool:'exec',...a});const mode=a.cmd.split(' ').at(-3);if(mode==='fail'){failed++;return terminal('');}if(mode==='bootstrap')return terminal('public request');if(mode==='reader')return terminal('response\n');const session=++id;sessions.set(session,{mode,polls:0});return live(emptyPolls?'':(mode==='capture'?captureReady:ready),session);},async write_stdin(a){calls.push({tool:'write',...a});if(a.session_id===9001)return live('feedback\n',9001);const s=sessions.get(a.session_id);assert.ok(s);if(a.chars===''){if(throwPoll)throw Error('uncertain poll');s.polls++;if(invalid)return invalid(a.session_id);return live(s.polls>=emptyPolls?(s.mode==='capture'?captureReady:ready):'',a.session_id);}if(s.mode==='capture')return terminal('capture receipt');const payload=JSON.parse(a.chars);assert.equal(payload.observerInitial.output,ready);return terminal(verdict);}};
 return h;
}
async function run(code,h,clock=globalThis.performance,date=Date){await new AsyncFunction('tools','store','load','text','performance','Date',code)(h.tools,h.store,h.load,h.text,clock,date);}
const program=phase=>completionTransportProgram({...options,phase}).replace('RESPONSE_DATA_VALUE',JSON.stringify('response\n'));

for(const emptyPolls of [0,1,3,9])test(`readiness polling preserves all phases with ${emptyPolls} empty readiness results`,async()=>{
 const h=harness({emptyPolls});for(const phase of ['bootstrap','capture','reader'])await run(program(phase),h);await run(completionTransportRelayProgram(options),h);
 assert.equal(h.failed,0);assert.equal(h.calls.filter(c=>c.tty).length,5);
 for(const c of h.calls.filter(c=>c.tty||c.chars===''))assert.equal(c.yield_time_ms,1000);
 assert.equal(h.calls.filter(c=>c.chars==='').length,5*emptyPolls);
 assert.equal(h.calls.filter(c=>c.session_id===9001).length,1);
 assert.equal([...h.state].filter(([key])=>key.endsWith('-readiness-observations')).length,5);
});
for(const [name,invalid] of [
 ['wrong marker',id=>({output:'wrong\n',session_id:id})],
 ['partial marker',id=>({output:ready.slice(0,10),session_id:id})],
 ['changed session',id=>({output:ready,session_id:id+1})],
 ['terminal exit',()=>({output:ready,exit_code:0})],
 ['missing output',id=>({session_id:id})],
])test(`readiness fails closed on ${name}`,async()=>{const h=harness({emptyPolls:1,invalid});await assert.rejects(run(program('bootstrap'),h),/readiness/);assert.equal(h.failed,1);assert.equal(h.calls.filter(c=>c.tool==='write'&&c.chars!=='').length,0);});
test('readiness polling is bounded and never writes payload after exhaustion',async()=>{const h=harness({emptyPolls:100});await assert.rejects(run(program('capture'),h),/timeout/);assert.equal(h.calls.filter(c=>c.chars==='').length,9);assert.equal(h.calls.filter(c=>c.tool==='write'&&c.chars!=='').length,0);assert.equal(h.failed,1);});
test('uncertain readiness poll is not retried',async()=>{const h=harness({emptyPolls:1,throwPoll:true});await assert.rejects(run(program('bootstrap'),h),/uncertain poll/);assert.equal(h.calls.filter(c=>c.chars==='').length,1);assert.equal(h.failed,1);});
test('relay observer failure cannot resend accepted payload',async()=>{const h=harness();await run(program('reader'),h);const original=h.tools.exec_command;h.tools.exec_command=async a=>{const result=await original(a);return a.cmd.includes(' relay-outcome ')?{...result,output:'wrong'}:result;};const relay=completionTransportRelayProgram(options);await assert.rejects(run(relay,h),/readiness/);await assert.rejects(run(relay,h),/failed|attempted/);assert.equal(h.calls.filter(c=>c.session_id===9001).length,1);});

for(const [name,times] of [['deadline boundary',[0,10000]],['late marker',[0,10001]],['clock regression',[100,99]],['invalid initial clock',[NaN]]])test(`readiness rejects ${name} before accepting READY`,async()=>{const h=harness();let i=0;await assert.rejects(run(program('bootstrap'),h,{now:()=>times[Math.min(i++,times.length-1)]}),/clock|timeout/);assert.equal(h.failed,1);assert.equal(h.calls.filter(c=>c.tool==='write').length,0);});
test('readiness trace payload retains empty polls and exact final native result',async()=>{const h=harness({emptyPolls:2});await run(program('capture'),h);const sent=h.calls.filter(c=>c.tool==='write'&&c.chars!==''),payload=JSON.parse(sent.at(-1).chars);assert.equal(payload.captureReadinessObservations.length,3);assert.equal(payload.observerReadinessObservations.length,3);assert.equal(payload.captureReadinessObservations[0].output,'');assert.deepEqual(payload.captureReadinessObservations.at(-1),payload.initial);assert.deepEqual(payload.observerReadinessObservations.at(-1),payload.observerInitial);});

test('readiness rejects READY arriving at the deadline on a later empty poll',async()=>{const h=harness({emptyPolls:1});const times=[0,9999,10000];let i=0;await assert.rejects(run(program('bootstrap'),h,{now:()=>times[Math.min(i++,2)]}),/timeout/);assert.equal(h.calls.filter(c=>c.chars==='').length,1);assert.equal(h.calls.filter(c=>c.tool==='write'&&c.chars!=='').length,0);});

for(const [name,times] of [['regression',[100,99]],['deadline',[0,10000]],['nonfinite',[0,NaN]]])test(`readiness Date fallback rejects ${name}`,async()=>{const h=harness();let i=0;await assert.rejects(run(program('bootstrap'),h,{},{now:()=>times[Math.min(i++,times.length-1)]}),/clock|timeout/);assert.equal(h.calls.filter(c=>c.tool==='write').length,0);});
