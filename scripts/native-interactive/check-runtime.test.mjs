import {spawnSync} from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Readable} from 'node:stream';
import {verifiedNode,inspectCheckRuntime,nativeCheckEnv,checkRuntimePolicy,verifyCellCheckRuntime} from './check-runtime.mjs';
import {supervise} from './cli.mjs';
import {digest,ARMS} from './protocol.mjs';
import {inventory} from './files.mjs';
const venv=fs.realpathSync(process.env.AIW_VENV??path.resolve(import.meta.dirname,'../../packages/tools/.venv'));
const retained=fs.mkdtempSync(path.join(os.tmpdir(),'native-offline-check-controls-'));
console.log(`retained offline-check controls: ${retained}`);
/** Synthetic tool-only cells, with no actor assignments, dispatch or campaign mutation. */
function fixture(arm,toolVenv=venv){
 const cellDir=fs.mkdtempSync(path.join(retained,`${arm}-`)),root=path.join(cellDir,'workspace');fs.mkdirSync(root);
 fs.writeFileSync(path.join(root,'bad.py'),'import os\n\n\ndef f(x: int) -> int:\n    return "a"\n');
 fs.writeFileSync(path.join(root,'good.py'),'def f(x: int) -> int:\n    return x\n');
 const c={arm,root,allowedWritePaths:[],venv:toolVenv,cellDir,journalDir:path.join(cellDir,'journal')},task='Synthetic checker smoke, no native actor.\n';
 fs.writeFileSync(path.join(cellDir,'config.json'),JSON.stringify(c)+'\n');fs.writeFileSync(path.join(cellDir,'TASK.md'),task);
 fs.writeFileSync(path.join(cellDir,'admission.json'),JSON.stringify({testOnly:true,config:c,checkRuntimePolicy:checkRuntimePolicy(),taskSHA256:digest(task)})+'\n');return c;
}
test('Python offline launcher controls provide complete non-skipped coverage',()=>{
 const root=path.resolve(import.meta.dirname,'../..');
 const result=spawnSync(path.join(venv,'bin/python'),[path.join(root,'packages/tools/test/offline-check.test.py'),'--json'],{cwd:root,env:{...nativeCheckEnv({venv},retained),PYTHONPATH:path.join(root,'packages/tools/python')},encoding:'utf8',timeout:60000,maxBuffer:1048576});
 fs.writeFileSync(path.join(retained,'python-controls.stdout.json'),result.stdout??'');fs.writeFileSync(path.join(retained,'python-controls.stderr.log'),result.stderr??'');
 assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
 const report=JSON.parse(result.stdout);assert.equal(report.kind,'native-offline-check-controls');
 assert.deepEqual(report.counts,{run:8,failures:0,errors:0,skipped:0,expectedFailures:0,unexpectedSuccesses:0});
});
test('narrow Node selection and explicit environment never inherit parent overrides',()=>{
 assert.throws(()=>verifiedNode('/missing-native-check-node'));
 process.env.NATIVE_CHECK_PRIVATE='synthetic';process.env.PYRIGHT_PYTHON_FORCE_VERSION='latest';
 try{const env=nativeCheckEnv({venv},retained);assert.equal(env.PATH,`${path.dirname(verifiedNode())}:/usr/local/bin:/usr/bin:/bin`);assert.equal(env.AIW_OFFLINE_CHECKS,'1');assert.equal(env.PYRIGHT_PYTHON_FORCE_VERSION,undefined);assert.equal(env.NATIVE_CHECK_PRIVATE,undefined);assert.equal(env.NODE_OPTIONS,undefined);}finally{delete process.env.NATIVE_CHECK_PRIVATE;delete process.env.PYRIGHT_PYTHON_FORCE_VERSION;}
});
test('preflight rejects source/bundle/node/version hash drift before an engine launch',()=>{
 const runtime=inspectCheckRuntime(venv,retained);
 for(const mutate of [r=>r.node.sha256='0'.repeat(64),r=>r.pyright.bundle.sha256='0'.repeat(64),r=>r.sources['check.py'].sha256='0'.repeat(64),r=>r.pyright.version='0.0.0']){const bad=structuredClone(runtime);mutate(bad);assert.throws(()=>inspectCheckRuntime(venv,retained,bad),/binding changed/);}
});
test('missing checker runtime is rejected by supervisor before worker, ready or host work',async()=>{
 const missingVenv=path.join(retained,'missing-venv');fs.mkdirSync(missingVenv);
 const c=fixture('direct',missingVenv);let output='';
 await assert.rejects(supervise(c,{input:Readable.from([]),stdout:s=>output+=s,stderr(){}}),/preflight failed/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(c.cellDir,'check-runtime-preflight.json'))).status,'failed');
 assert.equal(output,'');for(const name of ['supervisor-start.json','supervisor-ready.json','worker-config.json','worker-outcome.json','check-runtime.json','journal'])assert.equal(fs.existsSync(path.join(c.cellDir,name)),false,name);
});
test('real native supervisors produce matched default types and lint across all three arms',async()=>{
 const normalized=[];
 for(const arm of ARMS.filter(a=>!a.startsWith('orchestrate-'))){
  const c=fixture(arm),before=inventory(c.root);let output='',stderr='';
  const request=(sequence,file)=>arm==='direct'?{kind:'tools',sequence,calls:[{name:'check',args:{path:file}}]}:{kind:'branch',sequence,code:`async (tools) => await tools.check({path:${JSON.stringify(file)}})`};
  const input=Readable.from([JSON.stringify(request(1,'bad.py'))+'\n'+JSON.stringify(request(2,'good.py'))+'\n'+JSON.stringify({kind:'submit',sequence:3})+'\n']);
  const result=await supervise(c,{input,stdout:s=>output+=s,stderr:s=>stderr+=s});
  fs.writeFileSync(path.join(c.cellDir,'smoke-output.jsonl'),output);fs.writeFileSync(path.join(c.cellDir,'smoke-stderr.txt'),stderr);
  assert.equal(result.status,'submitted',JSON.stringify({arm,result,stderr}));assert.equal(result.cleanup,'closed');assert.deepEqual(inventory(c.root),before);
  const events=fs.readdirSync(c.journalDir).sort().map(name=>JSON.parse(fs.readFileSync(path.join(c.journalDir,name))));
  const checks=events.filter(e=>e.type==='host-result'&&e.event.name==='check').map(e=>e.event);
  assert.equal(checks.length,2);assert.ok(checks.every(e=>e.ok));
  const bad=checks[0].result,good=checks[1].result;
  assert.deepEqual(bad.diagnostics.map(d=>[d.source,d.code,d.line,d.col]),[['ruff','F401',1,8],['pyright','reportReturnType',5,12]]);
  assert.deepEqual(good,{diagnostics:[],counts:{}});normalized.push({bad,good});
  assert.equal(result.checkRuntimeSHA256,digest(fs.readFileSync(path.join(c.cellDir,'check-runtime.json'))));
  const admission=JSON.parse(fs.readFileSync(path.join(c.cellDir,'admission.json')));
  assert.equal(verifyCellCheckRuntime({cellDir:c.cellDir,admission,supervision:result}),result.checkRuntimeSHA256);
  assert.throws(()=>verifyCellCheckRuntime({cellDir:c.cellDir,admission,supervision:{...result,checkRuntimeSHA256:'0'.repeat(64)}}),/final evidence changed/);
  assert.throws(()=>verifyCellCheckRuntime({cellDir:c.cellDir,admission:{...admission,checkRuntimePolicy:{mode:'changed'}},supervision:result}),/admission policy changed/);
 }
 assert.deepEqual(normalized[0],normalized[1]);assert.deepEqual(normalized[1],normalized[2]);
});
