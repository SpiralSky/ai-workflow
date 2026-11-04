import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createNativeSession} from './session.ts';
import {inspectCheckRuntime,nativeCheckEnv} from './check-runtime.mjs';
import {createNativeCompletionBridge,NATIVE_COMPLETION_LIMITS,encodeNative,parseNativeCompletionFrame} from './native-completion.mjs';
import {captureThroughFixedHelpers,finalizeFixedHelperRelay,createFixedTransportTestBinding} from './completion-helper-test-support.mjs';
import {digest} from './protocol.mjs';
import {createCurrentWorkspaceReader} from './current-workspace.ts';
import {inventory} from './files.mjs';

const evidence=process.env.NATIVE_TEST_EVIDENCE??os.tmpdir();
const venv=path.resolve(import.meta.dirname,'../../packages/tools/.venv');
const runtime=inspectCheckRuntime(venv,os.tmpdir());
/** Complete the fixed transport around an actual bridge acceptance; retain each relay promise. */
function captureScripted(cellDir:string,sequence:number,response:Buffer,bridge:ReturnType<typeof createNativeCompletionBridge>,relayTasks:Promise<void>[]){
 const f={base:cellDir,cellDir};
 const task=(async()=>{
  await captureThroughFixedHelpers(f,sequence,response);
  bridge.accept(response);
  await finalizeFixedHelperRelay(f,sequence);
 })();
 relayTasks.push(task);
 return task;
}
const instruction='Run a narrow named test and summarize the first failing assertion';
const code='async (tools, state) => { state.result = await tools.runTests({target:"test_fixture.py",timeoutMs:10000}); return state.result; }';
/** Actual checked LocalHost/Sidecar, orchestrate engine, linked broker and durable native completion lane. */
async function matchedArm(hotPaths:boolean,override:boolean){
 const label=`${override?'override':'automatic'}-${hotPaths?'on':'off'}`;
 const cellDir=fs.mkdtempSync(path.join(evidence,`native-orchestrate-${label}-`));
 const root=path.join(cellDir,'workspace');fs.mkdirSync(root);
 const fixture='import unittest\nclass Fixture(unittest.TestCase):\n def test_public(self):\n  self.assertEqual(2 + 2, 4)\n';
 fs.writeFileSync(path.join(root,'test_fixture.py'),fixture);
 const arm=hotPaths?'orchestrate-on':'orchestrate-off';
 const binding=createFixedTransportTestBinding({cellDir,arm,cellId:path.basename(cellDir),limitsSHA256:digest(NATIVE_COMPLETION_LIMITS)});
 const requests:any[]=[],hostCalls:any[]=[],fatals:string[]=[];
 const relayTasks:Promise<void>[]=[];
 let secondary=0,selection=0,session:Awaited<ReturnType<typeof createNativeSession>>|undefined;
 const bridge=createNativeCompletionBridge({cellDir,binding,issueCapability:async()=>randomBytes(32).toString('hex'),checkActive(){},onFatal(error){fatals.push(error.message);session?.fail(error);},
  async emitRequest(raw){
   const envelope=parseNativeCompletionFrame(raw);requests.push(envelope.request);let message;
   if(envelope.request.tools.length===0){selection++;message={role:'assistant',content:'["runTests"]'};}
   else {secondary++;message=secondary===1?{role:'assistant',content:null,tool_calls:[{id:'branch_1',type:'function',function:{name:'branch',arguments:JSON.stringify({code})}}]}:{role:'assistant',content:secondary===2?'Invalid fixture reference @missing_saved.':'Ran the public fixture. See @s1.c1 and @result.'};}
   const {request,...fields}=envelope;const response=encodeNative({...fields,version:'native-completion-response-v1',message});
   await captureScripted(cellDir,envelope.completionSequence,response,bridge,relayTasks);
  }});
 session=await createNativeSession({arm,root,allowedWritePaths:[],venv,env:nativeCheckEnv({venv},os.tmpdir(),runtime),onHostAttempt:(name,args)=>hostCalls.push({name,args}),onFatal:e=>fatals.push(e.message),native:{cellDir,binding,bridge}});
 assert.deepEqual(session.packet.tools.map(t=>t.name),['do','resolve']);
 try{
  const [result]=await session.dispatch({kind:'do',sequence:1,args:{instruction,...(override?{tools:['runTests']}:{})}});
  assert.equal(result!.isError,false,result!.text);assert.match(result!.text,/Step: s1/);assert.match(result!.text,/@result/);
  const [resolved]=await session.dispatch({kind:'resolve',sequence:2,args:{ref:'@s1.c1'}});
  const [saved]=await session.dispatch({kind:'resolve',sequence:3,args:{ref:'@result'}});
  assert.equal(resolved!.isError,false);assert.equal(saved!.isError,false);assert.match(resolved!.text,/"passed": 1/);assert.equal(saved!.text,resolved!.text);
  assert.equal(selection,override?0:1);assert.equal(secondary,3);assert.equal(hostCalls.length,1);assert.equal(fatals.length,0);
  assert.ok(requests.filter(r=>r.tools.length)[2].messages.some((m:any)=>typeof m.content==='string'&&m.content.includes('Reply with the corrected report only')));
  await Promise.all(relayTasks);
  await session.close();const native=session.verifyNativeEvidence();
  assert.equal(native.completion.accepted.length,secondary+selection);assert.equal(native.event.input,null);assert.equal(native.event.output,null);assert.equal(native.event.costUsd,null);
  const events=native.event.files.filter(f=>f.kind==='native-event').map(f=>JSON.parse(fs.readFileSync(f.path,'utf8')).event);
  const handoff=events.find(e=>e.kind==='attach'&&e.key==='orchestrate.handoff').data;
  assert.equal(handoff.hotPaths.includes('test-failure-summary'),hotPaths&&!override);
  assert.equal(requests.filter(r=>r.tools.length)[0].messages[0].content.includes('Known-good patterns'),hotPaths&&!override);
  const record={label,binding,fixtureSHA256:digest(fixture),instruction,code,requests,hostCalls,result,resolved,saved,handoff,native,modelCalls:0,usage:'unknown-native-format-with-scripted-no-model-responses'};
  fs.writeFileSync(path.join(cellDir,'matched-record.json'),JSON.stringify(record,null,2)+'\n');return record;
 }finally{await session.close();}
}

test('first actual native completion orchestrate round trip with repair, saved state and resolve',async()=>{await matchedArm(false,false);});

test('matched four hot-path arms retain all raw request differences',async()=>{
 const records:Awaited<ReturnType<typeof matchedArm>>[]=[];
 for(const override of [false,true])for(const hotPaths of [false,true])records.push(await matchedArm(hotPaths,override));
 const comparisons=[];
 for(let i=0;i<records.length;i+=2){const a=records[i]!,b=records[i+1]!;
  for(const key of ['fixtureSHA256','instruction','code','hostCalls','result','resolved','saved'] as const)assert.deepEqual(a[key],b[key]);
  const changes:any[]=[];
  const walk=(x:any,y:any,p:string)=>{if(JSON.stringify(x)===JSON.stringify(y))return;if(x&&y&&typeof x==='object'&&typeof y==='object'&&Array.isArray(x)===Array.isArray(y)){for(const k of new Set([...Object.keys(x),...Object.keys(y)]))walk(x[k],y[k],p+'/'+k);return;}changes.push({path:p,leftPresent:x!==undefined,rightPresent:y!==undefined,left:x,right:y});};
  walk(a.requests,b.requests,'/requests');comparisons.push({left:a.label,right:b.label,exactEqualityObserved:changes.length===0,rawDifferences:changes});
 }
 const comparisonDir=fs.mkdtempSync(path.join(evidence,'native-four-arm-comparison-'));
 fs.writeFileSync(path.join(comparisonDir,'comparison.json'),JSON.stringify(comparisons,null,2)+'\n',{flag:'wx'});
});

test('guarded readers resolve current allowed edits/new files and reject protected/symlink drift',async()=>{
 const root=fs.mkdtempSync(path.join(evidence,'current-workspace-'));fs.writeFileSync(path.join(root,'a.py'),'value=1\n');fs.writeFileSync(path.join(root,'protected.txt'),'fixed');
 const seen:any[]=[],original=inventory(root);let fault:unknown;
 const readers=createCurrentWorkspaceReader({root,original,allowedWritePaths:['a.py','new.py'],onRead:r=>seen.push(r),onFatal:e=>{fault=e;return e instanceof Error?e:Error(String(e));}});
 fs.writeFileSync(path.join(root,'a.py'),'value=2\n');fs.writeFileSync(path.join(root,'new.py'),'created=True\n');
 assert.equal(await readers.reader.readFile('a.py'),'value=2\n');assert.equal(await readers.reader.readFile('new.py'),'created=True\n');assert.equal(await readers.pathExists('missing.py'),false);assert.equal(seen[0].sha256,digest('value=2\n'));
 fs.writeFileSync(path.join(root,'protected.txt'),'changed');await assert.rejects(readers.reader.readFile('a.py'),/protected path changed/);assert.ok(fault);
});

test('non-adapter native wire failure stays fatal after real doTool catches it and submit is attempted',async()=>{
 const cellDir=fs.mkdtempSync(path.join(evidence,'wire-fault-')),root=path.join(cellDir,'workspace');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'a.py'),'value=1\n');
 const binding=createFixedTransportTestBinding({cellDir,arm:'orchestrate-off',cellId:path.basename(cellDir),limitsSHA256:digest(NATIVE_COMPLETION_LIMITS)});
 let session:Awaited<ReturnType<typeof createNativeSession>>|undefined;
 const relayTasks:Promise<void>[]=[];
 const bridge=createNativeCompletionBridge({cellDir,binding,issueCapability:async()=>randomBytes(32).toString('hex'),checkActive(){},onFatal:e=>session?.fail(e),async emitRequest(raw){
  const envelope=parseNativeCompletionFrame(raw),{request,...rest}=envelope;
  const response=encodeNative({...rest,version:'native-completion-response-v1',message:{role:'assistant',content:'No tool needed.'}});
  await captureScripted(cellDir,envelope.completionSequence,response,bridge,relayTasks);
 }});
 const complete=bridge.client.complete.bind(bridge.client);
 // Deliberately corrupt the broker boundary, after a legitimate adapter completion receipt.
 bridge.client.complete=async req=>Object.assign(await complete(req),{costUsd:1});
 session=await createNativeSession({arm:'orchestrate-off',root,allowedWritePaths:[],venv,env:nativeCheckEnv({venv},os.tmpdir(),runtime),onHostAttempt(){throw Error('unexpected host effect');},native:{cellDir,binding,bridge}});
 await assert.rejects(session.dispatch({kind:'do',sequence:1,args:{instruction:'Return a short report',tools:[]}}));
 await Promise.all(relayTasks);
 assert.equal(session.failed,true);const first=session.fatalReason;assert.ok(first);
 await assert.rejects(session.dispatch({kind:'submit',sequence:2}));assert.equal(session.fatalReason,first);
 await assert.rejects(session.close());assert.equal(session.fatalReason,first);
 assert.throws(()=>session!.verifyNativeEvidence());
});

test('real orchestrate references read edited and new files, refSymbol detects stale current text',async()=>{
 const cellDir=fs.mkdtempSync(path.join(evidence,'native-reference-')),root=path.join(cellDir,'workspace');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'a.py'),'def value():\n    return 1\n');
 const binding=createFixedTransportTestBinding({cellDir,arm:'orchestrate-off',cellId:path.basename(cellDir),limitsSHA256:digest(NATIVE_COMPLETION_LIMITS)});
 let turns=0,session:Awaited<ReturnType<typeof createNativeSession>>|undefined;
 const relayTasks:Promise<void>[]=[];
 const script='async (tools, state) => { state.old = await tools.refSymbol({file:"a.py",name:"value"}); await tools.writeFile({path:"a.py",content:"def value():\\n    return 2\\n"}); await tools.writeFile({path:"new.py",content:"def fresh():\\n    return 3\\n"}); state.fresh = await tools.refSymbol({file:"new.py",name:"fresh"}); return "edited"; }';
 const bridge=createNativeCompletionBridge({cellDir,binding,issueCapability:async()=>randomBytes(32).toString('hex'),checkActive(){},onFatal:e=>session?.fail(e),async emitRequest(raw){
  const envelope=parseNativeCompletionFrame(raw),{request,...rest}=envelope;turns++;
  const message=turns===1?{role:'assistant',content:null,tool_calls:[{id:'edit_1',type:'function',function:{name:'branch',arguments:JSON.stringify({code:script})}}]}:{role:'assistant',content:'Changed @a.py#value and created @new.py#fresh. See @old and @fresh.'};
  const response=encodeNative({...rest,version:'native-completion-response-v1',message});
  await captureScripted(cellDir,envelope.completionSequence,response,bridge,relayTasks);
 }});
 session=await createNativeSession({arm:'orchestrate-off',root,allowedWritePaths:['a.py','new.py'],venv,env:nativeCheckEnv({venv},os.tmpdir(),runtime),onHostAttempt(){},native:{cellDir,binding,bridge}});
 try{
  const [result]=await session.dispatch({kind:'do',sequence:1,args:{instruction:'Edit the public functions',tools:['writeFile']}});assert.equal(result!.isError,false,result!.text);
  const [edited]=await session.dispatch({kind:'resolve',sequence:2,args:{ref:'@a.py#value'}});assert.match(edited!.text,/return 2/);
  const [created]=await session.dispatch({kind:'resolve',sequence:3,args:{ref:'@new.py#fresh'}});assert.match(created!.text,/return 3/);
  const [stale]=await session.dispatch({kind:'resolve',sequence:4,args:{ref:'@old'}});assert.match(stale!.text,/stale/);assert.match(stale!.text,/return 2/);
  await Promise.all(relayTasks);
  await session.close();const verified=session.verifyNativeEvidence();const events=verified.event.files.filter(f=>f.kind==='native-event').map(f=>JSON.parse(fs.readFileSync(f.path,'utf8')).event);
  const reads=events.filter(e=>e.key==='native.workspace-read');assert.ok(reads.some(e=>e.data.path==='a.py'&&e.data.content.includes('return 2')));assert.ok(reads.some(e=>e.data.path==='new.py'&&e.data.content.includes('return 3')));
 }finally{await session.close();}
});
