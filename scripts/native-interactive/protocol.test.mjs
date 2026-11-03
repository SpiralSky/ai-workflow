import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {Ledger,LIMITS,parseAction,boundedLines} from './protocol.mjs';
const tools=(sequence=1,calls=[{name:'readFile',args:{path:'a.py'}}])=>JSON.stringify({sequence,kind:'tools',calls});
test('direct and branch actions have exact finite schemas',()=>{
 assert.equal(parseAction(tools(),'direct',1).calls.length,1);
 assert.throws(()=>parseAction(tools(),'branch-expanded',1));
 assert.throws(()=>parseAction('{"sequence":1,"kind":"completion","prompt":"x"}','direct',1));
 assert.throws(()=>parseAction(tools(),'intern',1));
 assert.throws(()=>parseAction(tools(),'direct',2));
});
test('direct batching shares global60 host-call ceiling, no arbitrary8 cap',()=>{
 assert.equal(parseAction(tools(1,Array.from({length:60},()=>({name:'readFile',args:{}}))),'direct',1).calls.length,60);
 const l=new Ledger('direct');l.reserve(tools());for(let i=0;i<60;i++)l.hostAttempt('readFile',{});
 assert.throws(()=>l.hostAttempt('readFile',{}));assert.equal(l.state,'failed');assert.throws(()=>l.finish({}));
});
test('reserve, complete, submit and replay are irreversible',()=>{
 const l=new Ledger('direct');l.reserve(tools());assert.throws(()=>l.reserve(tools()));l.finish({ok:true});
 l.reserve('{"sequence":2,"kind":"submit"}');l.finish({},true);assert.throws(()=>l.reserve(tools(3)));
 const bad=new Ledger('direct');assert.throws(()=>bad.reserve(tools(2)));assert.equal(bad.state,'failed');
});
test('feedback overflow is explicit and sticky',()=>{
 const l=new Ledger('direct');l.reserve(tools());assert.throws(()=>l.finish('x'.repeat(LIMITS.feedbackBytes)));assert.equal(l.state,'failed');
});
test('streaming lines support split unicode and reject oversized/unclosed/malformed UTF8',async()=>{
 const b=Buffer.from('é\n');const result=[];for await(const l of boundedLines(Readable.from([b.subarray(0,1),b.subarray(1)])))result.push(l);assert.deepEqual(result,['é']);
 for(const chunks of [[Buffer.from('abcd')],[Buffer.from('x')],[Buffer.from([255,10])]])await assert.rejects(async()=>{for await(const l of boundedLines(Readable.from(chunks),3))void l;});
});
test('captured objects cannot be rewritten by handler mutation',()=>{
 const l=new Ledger('direct');const a=l.reserve(tools());a.calls[0].args.path='changed';assert.equal(l.events[0].action.calls[0].args.path,'a.py');
 const args={path:'x'};l.hostAttempt('readFile',args);args.path='y';assert.equal(l.events[1].args.path,'x');
 const result={ok:true};l.finish(result);result.ok=false;assert.equal(l.events[2].result.ok,true);assert.throws(()=>l.events.pop());
});
test('unserializable or cyclic result closes cell as failed',()=>{
 for(const result of [undefined,BigInt(1),(()=>{const x={};x.self=x;return x;})()]) {
  const l=new Ledger('direct');l.reserve(tools());assert.throws(()=>l.finish(result));assert.equal(l.state,'failed');
 }
});
test('result serialization runs once, measured JSON is captured exactly',()=>{
 let calls=0; const result={toJSON(){if(++calls>1)throw new Error('second serialization');return {value:42};}};
 const l=new Ledger('direct');l.reserve(tools());l.finish(result);assert.equal(calls,1);assert.equal(l.feedback,Buffer.byteLength('{"value":42}'));assert.deepEqual(l.events.at(-1).result,{value:42});
});

test('authentic hotpath arm uses same branch schema and limits',()=>{const action=JSON.stringify({sequence:1,kind:'branch',code:'return 1;'});assert.deepEqual(parseAction(action,'branch-hotpath2',1),parseAction(action,'branch-expanded',1));assert.throws(()=>parseAction(tools(),'branch-hotpath2',1));assert.throws(()=>parseAction(JSON.stringify({sequence:1,kind:'branch',code:'x'.repeat(LIMITS.sourceBytes+1)}),'branch-hotpath2',1));});
