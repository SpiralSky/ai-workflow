import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {digest} from './protocol.mjs';
import {createActionReceiptTracker} from './action-receipts.mjs';
import {createActionReceiptStore,validateActionReceiptEvidence} from './action-receipt-files.mjs';
/** Actor-free synthetic artifact chain; retained on failure instead of repairing/retrying it. */
async function fixture(){
 const cellDir=fs.mkdtempSync(path.join(os.tmpdir(),'action-receipt-files-')),journalDir=path.join(cellDir,'journal');fs.mkdirSync(journalDir);
 const metadata={'assignment.json':{actorId:'synthetic-no-actor'},'admission.json':{testOnly:true},'config.json':{arm:'branch-expanded'},'supervisor-start.json':{testOnly:true},'actor-dispatch-intent.json':{testOnly:true}};
 for(const [name,value]of Object.entries(metadata))fs.writeFileSync(path.join(cellDir,name),JSON.stringify(value)+'\n');
 const hash=name=>digest(fs.readFileSync(path.join(cellDir,name))),bindings={assignmentSHA256:hash('assignment.json'),admissionSHA256:hash('admission.json'),configSHA256:hash('config.json'),supervisorStartSHA256:hash('supervisor-start.json'),dispatchIntentSHA256:hash('actor-dispatch-intent.json')};
 const store=createActionReceiptStore({cellDir}),emitted=[],observations=[];const tracker=createActionReceiptTracker({arm:'branch-expanded',bindings,checkActive(){},...store,persistInput(record,raw){store.persistInput(record,raw);observations.push({type:'action-received',monotonicMs:observations.length,...record});},persistAck(record){store.persistAck(record);observations.push({type:'action-receipt-ack',monotonicMs:observations.length,...record});},async emit(receipt,raw){emitted.push(Buffer.concat([receipt,raw]));}});
 const raw=[Buffer.from('{ "code":"café 🐢", "kind":"branch", "sequence":1 }\r\n'),Buffer.from('{"sequence":2,"kind":"submit"}\n')],feedback=[Buffer.from('{"kind":"result","sequence":1,"result":"café 🐢"}\n'),Buffer.from('{"kind":"submitted","submission":{"provisional":true}}\n')];
 for(let i=0;i<2;i++){tracker.input(raw[i]);await tracker.feedback(feedback[i]);fs.writeFileSync(path.join(journalDir,String(i*2+1).padStart(6,'0')+'.json'),JSON.stringify({type:'reserved',action:JSON.parse(raw[i])}));fs.writeFileSync(path.join(journalDir,String(i*2+2).padStart(6,'0')+'.json'),JSON.stringify({type:'emission-attempt',initial:false,text:feedback[i].toString()}));}
 tracker.inputEOF();tracker.feedbackEOF();const supervision={actionReceipts:tracker.assertComplete(),coordinatorActionReceiptBytes:tracker.snapshot.receiptOutputBytes,bytesIn:raw.reduce((n,b)=>n+b.length,0),outcome:{visibleFeedbackBytes:feedback.reduce((n,b)=>n+b.length,0)},timing:{observations}};return{cellDir,journalDir,supervision,raw,feedback,emitted};
}
test('fixed exclusive store recomputes exact input including CRLF and journal-matched feedback',async()=>{
 const f=await fixture(),checked=validateActionReceiptEvidence(f);assert.equal(checked.count,2);assert.equal(checked.receiptBytes,f.supervision.coordinatorActionReceiptBytes);assert.equal(checked.feedbackBytes,f.feedback.reduce((n,b)=>n+b.length,0));assert.deepEqual(fs.readFileSync(path.join(f.cellDir,'action-receipts/000001.input.jsonl')),f.raw[0]);
 const receipt=JSON.parse(f.emitted[0].subarray(0,f.emitted[0].indexOf(10)));assert.equal(receipt.inputSHA256,digest(f.raw[0]));assert.equal(receipt.feedbackSHA256,digest(f.feedback[0]));assert.deepEqual(f.emitted[0].subarray(f.emitted[0].indexOf(10)+1),f.feedback[0]);
});
test('changed raw, receipt, acknowledgement or worker journal cannot pass final evidence',async()=>{
 for(const [relative,mutate] of [['action-receipts/000001.input.jsonl',bytes=>Buffer.from(bytes.toString().replace('café','cafe'))],['action-receipts/000001.receipt.jsonl',bytes=>Buffer.from(bytes.toString().replace('"sequence":1','"sequence":2'))],['action-receipts/000001.ack.json',bytes=>Buffer.concat([bytes,Buffer.from(' ')])],['journal/000002.json',bytes=>Buffer.from(bytes.toString().replace('café','cafe'))]]){const f=await fixture(),file=path.join(f.cellDir,relative);fs.writeFileSync(file,mutate(fs.readFileSync(file)));assert.throws(()=>validateActionReceiptEvidence(f));}
});
test('missing, dangling, pending or changed-assignment evidence is incomplete',async()=>{
 const f=await fixture();fs.writeFileSync(path.join(f.cellDir,'action-receipts/000003.input.jsonl'),'{}\n');assert.throws(()=>validateActionReceiptEvidence(f),/dangling/);
 const g=await fixture();g.supervision.actionReceipts={...g.supervision.actionReceipts,pending:3};assert.throws(()=>validateActionReceiptEvidence(g),/incomplete/);
 const h=await fixture();fs.appendFileSync(path.join(h.cellDir,'assignment.json'),' ');assert.throws(()=>validateActionReceiptEvidence(h),/binding/);
 const i=await fixture();i.supervision.coordinatorActionReceiptBytes++;assert.throws(()=>validateActionReceiptEvidence(i),/accounting/);
});
test('failed exclusive reservation retains partial evidence and poisons the store',()=>{
 const cellDir=fs.mkdtempSync(path.join(os.tmpdir(),'action-receipt-store-failure-')),store=createActionReceiptStore({cellDir});fs.writeFileSync(path.join(cellDir,'action-receipts/000001.input.json'),'preexisting');assert.throws(()=>store.persistInput({sequence:1},Buffer.from('{}\n')),/EEXIST/);assert.equal(fs.readFileSync(path.join(cellDir,'action-receipts/000001.input.jsonl'),'utf8'),'{}\n');assert.throws(()=>store.persistInput({sequence:2},Buffer.from('{}\n')),/failed/);assert.equal(fs.existsSync(path.join(cellDir,'action-receipts/000002.input.jsonl')),false);assert.throws(()=>createActionReceiptStore({cellDir}),/EEXIST/);
});

test('independent worker counters and per-sequence observations cannot drift',async()=>{for(const mutate of [s=>s.bytesIn++,s=>s.outcome.visibleFeedbackBytes++,s=>s.timing.observations[0].inputSHA256='0'.repeat(64),s=>s.timing.observations[1].receiptBytes++,s=>s.timing.observations.reverse()]){const f=await fixture();mutate(f.supervision);assert.throws(()=>validateActionReceiptEvidence(f),/accounting|observation/);}});
