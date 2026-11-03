import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNativeSession,CATALOG} from './session.ts';
const venv=fs.realpathSync(process.env.AIW_VENV??[path.resolve(import.meta.dirname,'../../packages/tools/.venv'),'/opt/aiw/venv'].find(p=>fs.existsSync(path.join(p,'bin/python')))??'/opt/aiw/venv');
if(!fs.existsSync(path.join(venv,'bin/python')))throw new Error('verified Python venv required; set AIW_VENV');
async function fixture(arm:'direct'|'branch-expanded',f:(s:Awaited<ReturnType<typeof createNativeSession>>,root:string,events:unknown[])=>Promise<void>){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-real-session-'));fs.writeFileSync(path.join(root,'a.py'),'value = 1\n');fs.writeFileSync(path.join(root,'protected.txt'),'unchanged');const events:unknown[]=[];
 const s=await createNativeSession({arm,root,allowedWritePaths:['a.py','new.py'],venv,env:{PATH:'/usr/bin:/bin',HOME:os.tmpdir(),AIW_VENV:venv,PYTHONDONTWRITEBYTECODE:'1'},onHostAttempt:(name,args)=>{events.push({name,args});},onHostResult:e=>events.push(e)});
 try{await f(s,root,events);}finally{await s.close();fs.rmSync(root,{recursive:true,force:true});}
}
test('actual baseline read, edit and feedback',async()=>fixture('direct',async(s,root,events)=>{
 assert.deepEqual(s.packet.tools.map(t=>t.name),[...CATALOG]);assert.deepEqual(s.packet.allowedWritePaths,['a.py','new.py']);
 const out=await s.dispatch({kind:'tools',calls:[{name:'readFile',args:{path:'a.py'}},{name:'edit',args:{path:'a.py',old:'1',new:'2'}}]});
 assert.equal(out.length,2);assert.equal(out[0]!.isError,false);assert.match(out[0]!.text,/value = 1/);assert.equal(fs.readFileSync(path.join(root,'a.py'),'utf8'),'value = 2\n');assert.equal(events.length,4);
}));
test('actual branch handler preserves state across actions and edits real files',async()=>fixture('branch-expanded',async(s,root)=>{
 const first=await s.dispatch({kind:'branch',code:'async (tools, state) => { state.n = 1; return await tools.readFile({path:"a.py"}); }'});assert.equal(first[0]!.isError,false);
 const second=await s.dispatch({kind:'branch',code:'async (tools, state) => { if (state.n !== 1) throw new Error("lost state"); await tools.edit({path:"a.py",old:"1",new:"3"}); return "done"; }'});assert.equal(second[0]!.isError,false);assert.equal(fs.readFileSync(path.join(root,'a.py'),'utf8'),'value = 3\n');
}));
test('all multiEdit targets checked before any side effect, denial sticky',async()=>fixture('direct',async(s,root,events)=>{
 await assert.rejects(s.dispatch({kind:'tools',calls:[{name:'multiEdit',args:{edits:[{path:'a.py',old:'1',new:'2'},{path:'protected.txt',old:'unchanged',new:'changed'}]}}]}));
 assert.equal(fs.readFileSync(path.join(root,'a.py'),'utf8'),'value = 1\n');assert.equal(s.failed,true);assert.equal(events.length,1);await assert.rejects(s.dispatch({kind:'tools',calls:[{name:'readFile',args:{path:'a.py'}}]}));
}));
test('external protected mutation is detected before subsequent tool invocation',async()=>fixture('direct',async(s,root,events)=>{
 fs.writeFileSync(path.join(root,'protected.txt'),'tampered');await assert.rejects(s.dispatch({kind:'tools',calls:[{name:'readFile',args:{path:'a.py'}}]}));assert.equal(s.failed,true);assert.equal(events.length,0);
}));
test('symlink creation is rejected before real tool traversal',async()=>fixture('direct',async(s,root)=>{
 fs.symlinkSync('/tmp',path.join(root,'escape'));await assert.rejects(s.dispatch({kind:'tools',calls:[{name:'readFile',args:{path:'escape/file'}}]}));assert.equal(s.failed,true);
}));
test('real Python sidecar runs fixture unittest with explicit child environment',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-sidecar-session-'));
 fs.writeFileSync(path.join(root,'test_example.py'),'import unittest, os\nclass Example(unittest.TestCase):\n def test_real(self):\n  self.assertEqual(2 + 2, 4)\n  self.assertNotIn("NATIVE_TEST_SENTINEL", os.environ)\n');
 process.env.NATIVE_TEST_SENTINEL='synthetic-not-a-credential';
 const s=await createNativeSession({arm:'direct',root,allowedWritePaths:[],venv,env:{PATH:'/usr/bin:/bin',HOME:os.tmpdir(),AIW_VENV:venv,PYTHONDONTWRITEBYTECODE:'1'},onHostAttempt(){}});
 try {const results=await s.dispatch({kind:'tools',calls:[{name:'runTests',args:{target:'test_example.py',timeoutMs:10000}}]});assert.equal(results[0]!.isError,false,results[0]!.text);const result=JSON.parse(results[0]!.text);assert.equal(result.passed,1);assert.equal(result.skipped,0);assert.deepEqual(result.failed,[]);}finally{delete process.env.NATIVE_TEST_SENTINEL;await s.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('unknown arm is refused before any root or resource access',async()=>{
 await assert.rejects(createNativeSession({arm:'invented',root:'/missing',allowedWritePaths:[],venv,env:{},onHostAttempt(){}} as any),/unavailable arm/);
});
test('post-effect observer failure closes session rather than allowing mutation retry',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-observer-session-'));fs.writeFileSync(path.join(root,'a.py'),'value = 1\n');
 const s=await createNativeSession({arm:'direct',root,allowedWritePaths:['a.py'],venv,env:{PATH:'/usr/bin:/bin',HOME:os.tmpdir(),AIW_VENV:venv,PYTHONDONTWRITEBYTECODE:'1'},onHostAttempt(){},onHostResult(){throw new Error('journal unavailable');}});
 try{await assert.rejects(s.dispatch({kind:'tools',calls:[{name:'edit',args:{path:'a.py',old:'1',new:'2'}}]}));assert.equal(s.failed,true);assert.equal(fs.readFileSync(path.join(root,'a.py'),'utf8'),'value = 2\n');}finally{await s.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('signal abort after final real tool completion is not accepted as success',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-abort-session-'));fs.writeFileSync(path.join(root,'a.py'),'value = 1\n');const controller=new AbortController();
 const s=await createNativeSession({arm:'direct',root,allowedWritePaths:[],venv,env:{PATH:'/usr/bin:/bin',HOME:os.tmpdir(),AIW_VENV:venv,PYTHONDONTWRITEBYTECODE:'1'},onHostAttempt(){},onHostResult(){controller.abort();}});
 try{await assert.rejects(s.dispatch({kind:'tools',calls:[{name:'readFile',args:{path:'a.py'}}]},controller.signal));assert.equal(s.failed,true);}finally{await s.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('observer cannot mutate the actual tool result returned to the worker',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-observer-copy-'));fs.writeFileSync(path.join(root,'a.py'),'value = 1\n');
 const s=await createNativeSession({arm:'direct',root,allowedWritePaths:['a.py'],venv,env:{PATH:'/usr/bin:/bin',HOME:os.tmpdir(),AIW_VENV:venv,PYTHONDONTWRITEBYTECODE:'1'},onHostAttempt(){},onHostResult(event){const e=event as any;if(e.result?.files)e.result.files[0].path='tampered';}});
 try{const out=await s.dispatch({kind:'tools',calls:[{name:'edit',args:{path:'a.py',old:'1',new:'2'}}]});assert.equal(out[0]!.isError,false);assert.doesNotMatch(out[0]!.text,/tampered/);}finally{await s.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('close is idempotent and subsequent dispatch is refused',async()=>fixture('direct',async(s)=>{
 const first=s.close();const second=s.close();assert.equal(first,second);await first;
 await assert.rejects(s.dispatch({kind:'tools',calls:[{name:'readFile',args:{path:'a.py'}}]}));
 assert.equal(s.failed,true);
}));
