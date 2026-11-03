import test from 'node:test';
import assert from 'node:assert/strict';
import {createActionReceiptTracker,RECEIPT_LIMITS} from './action-receipts.mjs';
import {digest,LIMITS} from './protocol.mjs';
const bindings={assignmentSHA256:'a'.repeat(64),admissionSHA256:'b'.repeat(64),configSHA256:'c'.repeat(64),supervisorStartSHA256:'d'.repeat(64),dispatchIntentSHA256:'e'.repeat(64)};
const frame=value=>Buffer.from(JSON.stringify(value)+'\n');
const action=(sequence=1)=>frame({sequence,kind:'branch',code:'café 🦉'});
const submit=(sequence=1)=>frame({sequence,kind:'submit'});
const result=(sequence=1)=>frame({kind:'result',sequence,result:{text:'café 🦉'}});
const submitted=()=>frame({kind:'submitted',submission:{provisional:true}});
/** Record effects in order without external resources. */
function setup(overrides={}){
 const events=[];
 const tracker=createActionReceiptTracker({arm:'branch-expanded',bindings,checkActive(){},persistInput(record,raw){events.push(['input',record,raw]);},persistFeedback(record,raw){events.push(['feedback',record,raw]);},async emit(receipt,raw){events.push(['emit',receipt,raw]);},persistAck(record){events.push(['ack',record]);},...overrides});
 return {tracker,events};
}
/** Assert the original rejection poisons subsequent operations. */
function sticky(tracker){assert.equal(tracker.snapshot.failed,true);assert.throws(()=>tracker.input(submit()));assert.throws(()=>tracker.assertComplete());}

test('split UTF8 and LF preserve exact input and feedback bytes and hashes',async()=>{
 const {tracker:t,events}=setup();const input=action(),feedback=result();
 for(let i=0;i<input.length-1;i++)assert.equal(t.input(input.subarray(i,i+1)),null);
 assert.deepEqual(t.input(input.subarray(-1)),input);
 assert.equal(events.length,1);
 for(let i=0;i<feedback.length;i++)await t.feedback(feedback.subarray(i,i+1));
 assert.deepEqual(events.map(e=>e[0]),['input','feedback','emit','ack']);
 const receipt=events[1][1];assert.equal(receipt.inputSHA256,digest(input));assert.equal(receipt.inputBytes,input.length);assert.equal(receipt.feedbackSHA256,digest(feedback));assert.equal(receipt.feedbackBytes,feedback.length);
 assert.deepEqual(events[2][2],feedback);assert.equal(events[3][1].receiptSHA256,digest(events[2][1]));
 assert.equal(t.snapshot.receivedCount,1);assert.equal(t.snapshot.acknowledgedCount,1);assert.equal(t.snapshot.pending,null);
 t.input(submit(2));await t.feedback(submitted());t.inputEOF();t.feedbackEOF();assert.equal(t.assertComplete().submitted,true);
 assert.ok(t.snapshot.receiptOutputBytes<=RECEIPT_LIMITS.totalBytes);
});

test('CRLF remains in persisted and emitted bytes',async()=>{
 const {tracker:t,events}=setup();const input=Buffer.from('{"sequence":1,"kind":"submit"}\r\n'),feedback=Buffer.from('{"kind":"submitted","submission":{}}\r\n');
 assert.deepEqual(t.input(input),input);await t.feedback(feedback);
 assert.deepEqual(events[0][2],input);assert.deepEqual(events[2][2],feedback);assert.equal(events[1][1].feedbackSHA256,digest(feedback));t.assertComplete();
});

test('bindings are canonical and extra keys are rejected',async()=>{
 const {tracker:t,events}=setup({bindings:Object.fromEntries(Object.entries(bindings).reverse())});t.input(submit());await t.feedback(submitted());
 assert.deepEqual(Object.keys(events[0][1]).slice(1,6),Object.keys(bindings));
 assert.throws(()=>setup({bindings:{...bindings,extra:'x'}}),/bindings/);
});

test('input limit permits payload ceiling plus LF and rejects excess before persistence',()=>{
 const bare=submit().subarray(0,-1),raw=Buffer.concat([bare,Buffer.alloc(LIMITS.lineBytes-bare.length,32),Buffer.from('\n')]);
 assert.deepEqual(setup().tracker.input(raw),raw);
 const {tracker:t,events}=setup();assert.throws(()=>t.input(Buffer.concat([Buffer.from(' '),raw])),/large/);assert.equal(events.length,0);sticky(t);
});

test('feedback frame ceiling includes LF',async()=>{
 const bare=submitted().subarray(0,-1),raw=Buffer.concat([bare,Buffer.alloc(LIMITS.lineBytes-bare.length-1,32),Buffer.from('\n')]);
 const {tracker:t}=setup();t.input(submit());await t.feedback(raw);t.assertComplete();
 const {tracker:u,events}=setup();u.input(submit());await assert.rejects(u.feedback(Buffer.concat([Buffer.from(' '),raw])),/large/);assert.equal(events.length,1);sticky(u);
});

test('fatal input and feedback UTF8 errors are sticky',async()=>{
 const {tracker:t,events}=setup();assert.throws(()=>t.input(Buffer.from([0xc3,0x28,10])),/encoded data/);assert.equal(events.length,0);sticky(t);
 const {tracker:u,events:ue}=setup();u.input(action());await assert.rejects(u.feedback(Buffer.from([0xc3,0x28,10])),/encoded data/);assert.equal(ue.length,1);sticky(u);
});

test('coalesced input or feedback including partial next frame has no downstream effect',async()=>{
 for(const suffix of [submit(2),Buffer.from('x')]){
  const {tracker:t,events}=setup();assert.throws(()=>t.input(Buffer.concat([action(),suffix])),/coalesced/);assert.equal(events.length,0);sticky(t);
  const {tracker:u,events:ue}=setup();u.input(action());await assert.rejects(u.feedback(Buffer.concat([result(),suffix])),/coalesced/);assert.equal(ue.length,1);sticky(u);
 }
});

test('pending next action, malformed action and replay are rejected',async()=>{
 const {tracker:t}=setup();t.input(action());assert.throws(()=>t.input(submit(2)),/pending/);sticky(t);
 for(const raw of [frame({sequence:2,kind:'submit'}),frame({sequence:1,kind:'submit',extra:true}),Buffer.from('bad\n')]){const {tracker:u,events}=setup();assert.throws(()=>u.input(raw));assert.equal(events.length,0);sticky(u);}
 const {tracker:u}=setup();u.input(action());await u.feedback(result());assert.throws(()=>u.input(action()),/sequence/);sticky(u);
});

test('exactly twelve rounds including final-round submit',async()=>{
 const {tracker:t}=setup();for(let sequence=1;sequence<12;sequence++){t.input(action(sequence));await t.feedback(result(sequence));}
 t.input(submit(12));await t.feedback(submitted());assert.equal(t.assertComplete().acknowledgedCount,12);assert.throws(()=>t.input(submit(13)),/terminal/);
 const {tracker:u}=setup();for(let sequence=1;sequence<12;sequence++){u.input(action(sequence));await u.feedback(result(sequence));}
 assert.throws(()=>u.input(action(12)),/final round/);sticky(u);
});

test('ready, duplicate, out-of-order and submitted/result mismatch rejected',async()=>{
 for(const feedback of [frame({kind:'ready',packet:{}}),result(2),submitted(),frame({kind:'result',sequence:1,result:{},extra:0})]){
  const {tracker:t,events}=setup();t.input(action());await assert.rejects(t.feedback(feedback));assert.equal(events.length,1);sticky(t);
 }
 const {tracker:t}=setup();t.input(action());await t.feedback(result());await assert.rejects(t.feedback(result()),/without pending/);sticky(t);
 const {tracker:u}=setup();u.input(submit());await assert.rejects(u.feedback(result()),/expected submitted/);sticky(u);
 const {tracker:v}=setup();v.input(submit());await assert.rejects(v.feedback(frame({kind:'submitted',sequence:1,submission:{}})),/expected submitted/);sticky(v);
});

test('input, feedback and ack persistence failures stop at their effect',async()=>{
 for(const hook of ['persistInput','persistFeedback','persistAck']){
  const {tracker:t,events}=setup({[hook](){throw Error(hook);}});
  if(hook==='persistInput'){assert.throws(()=>t.input(action()),/persistInput/);assert.equal(events.length,0);}
  else{t.input(action());await assert.rejects(t.feedback(result()),new RegExp(hook));assert.deepEqual(events.map(e=>e[0]),hook==='persistFeedback'?['input']:['input','feedback','emit']);}
  assert.equal(t.snapshot.acknowledgedCount,0);sticky(t);
 }
});

test('async persistence is rejected rather than mistaken for durable acknowledgement',async()=>{
 const {tracker:t}=setup({persistInput:async()=>{throw Error('async failure');}});assert.throws(()=>t.input(action()),/synchronous/);sticky(t);
 const {tracker:u}=setup({persistAck:async()=>{}});u.input(action());await assert.rejects(u.feedback(result()),/synchronous/);sticky(u);
});

test('emit rejection or late fulfillment never acknowledges',async()=>{
 const {tracker:t}=setup({emit:async()=>{throw Error('write rejected');}});t.input(action());await assert.rejects(t.feedback(result()),/write rejected/);assert.equal(t.snapshot.acknowledgedCount,0);sticky(t);
 let expired=false;const {tracker:u,events}=setup({checkActive(){if(expired)throw Error('deadline');},emit:async()=>{expired=true;}});u.input(action());await assert.rejects(u.feedback(result()),/deadline/);assert.equal(events.some(e=>e[0]==='ack'),false);sticky(u);
});

test('pipelining while emit awaits poisons a late successful emit',async()=>{
 let release;const {tracker:t,events}=setup({emit:()=>new Promise(resolve=>{release=resolve;})});t.input(action());const pending=t.feedback(result());assert.throws(()=>t.input(submit(2)),/pending/);release();await assert.rejects(pending,/pending/);assert.equal(events.some(e=>e[0]==='ack'),false);sticky(t);
});

test('active deadline checks cover synchronous persistence and ack',async()=>{
 for(const hook of ['persistInput','persistFeedback','persistAck']){
  let expired=false;const {tracker:t}=setup({checkActive(){if(expired)throw Error('expired');},[hook](){expired=true;}});
  if(hook==='persistInput')assert.throws(()=>t.input(action()),/expired/);
  else{t.input(action());await assert.rejects(t.feedback(result()),/expired/);}
  assert.equal(t.snapshot.acknowledgedCount,0);sticky(t);
 }
});

test('EOF fragments, pending feedback and pre-submit session remain incomplete',async()=>{
 for(const end of ['inputEOF','feedbackEOF']){
  const {tracker:t}=setup();assert.throws(()=>t[end](),/incomplete/);sticky(t);
  const {tracker:u}=setup();u.input(submit());assert.throws(()=>u[end](),/incomplete/);sticky(u);
  const {tracker:v}=setup();v.input(action());await v.feedback(result());assert.throws(()=>v[end](),/incomplete/);sticky(v);
 }
 const {tracker:t}=setup();t.input(Buffer.from('{'));assert.throws(()=>t.inputEOF(),/incomplete/);sticky(t);
 const {tracker:u}=setup();u.input(action());await u.feedback(Buffer.from('{'));assert.throws(()=>u.feedbackEOF(),/incomplete/);sticky(u);
});


test('BOM is not normalized away before input or feedback parsing',async()=>{
 const BOM=Buffer.from([0xef,0xbb,0xbf]);
 const {tracker:t,events}=setup();assert.throws(()=>t.input(Buffer.concat([BOM,submit()])));assert.equal(events.length,0);sticky(t);
 const {tracker:u,events:ue}=setup();u.input(submit());await assert.rejects(u.feedback(Buffer.concat([BOM,submitted()])));assert.equal(ue.length,1);sticky(u);
});
