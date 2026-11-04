import fs from 'node:fs';
import path from 'node:path';
import {readConfig,sanitizedEnv,writeStream} from './cli.mjs';
import {runCell} from './controller.mjs';
import {readBounded,Journal} from './files.mjs';
import {digest}from './protocol.mjs';
import {createNativeCompletionBridge} from './native-completion.mjs';
import {completionBinding} from './completion-lane.mjs';
import {createWorkerCompletionLane} from './completion-worker-lane.mjs';
import {createNativeSession} from './session.ts';
// Invoked only by finite supervisor with an explicit minimal whole-process environment.
const c=readConfig(process.argv[2]);
if(!process.env.HOME)throw new Error('missing isolated home');
const runtime=JSON.parse(readBounded(path.join(c.cellDir,'check-runtime.json'),16384).toString('utf8'));
const expected=sanitizedEnv(c,process.env.HOME,runtime);
if(Object.keys(process.env).sort().join(',')!==Object.keys(expected).sort().join(',')||Object.entries(expected).some(([k,v])=>process.env[k]!==v))throw new Error('worker environment mismatch');
process.stdout.on('error',()=>{});
const publicTask=readBounded(path.join(c.cellDir,'TASK.md'),32768).toString('utf8');
const admission=JSON.parse(readBounded(path.join(c.cellDir,'admission.json')).toString('utf8'));
if(digest(publicTask)!==admission.taskSHA256)throw new Error('public task changed');
const journal=new Journal(c.journalDir);
const outcome=await runCell({arm:c.arm,evidenceMode:admission.evidenceMode??'synthetic-control',input:process.stdin,emit:(line:string)=>writeStream(process.stdout,line),journal,
 createSession:async(callbacks)=>{
  const orchestrate=c.arm==='orchestrate-off'||c.arm==='orchestrate-on';
  if(!orchestrate)return createNativeSession({...callbacks,arm:c.arm,publicTask,root:c.root,allowedWritePaths:c.allowedWritePaths,venv:c.venv,env:expected});
  const binding=completionBinding(admission,digest(readBounded(path.join(c.cellDir,'admission.json'))),path.basename(c.cellDir));
  let session:Awaited<ReturnType<typeof createNativeSession>>|undefined,firstFatal:unknown,bridge:ReturnType<typeof createNativeCompletionBridge>;
  const onFatal=(error:unknown)=>{if(firstFatal)return;firstFatal=error;callbacks.onFatal(error);session?.fail(error);void lane.notifyFatal(error);};
  const lane=createWorkerCompletionLane({binding,onFatal,accept:(raw:Buffer)=>bridge.accept(raw)});
  bridge=createNativeCompletionBridge({cellDir:c.cellDir,binding,issueCapability:lane.issueCapability,emitRequest:lane.emitRequest,onFatal,checkActive(){if(firstFatal)throw firstFatal;}});
  try{session=await createNativeSession({...callbacks,onFatal,arm:c.arm,publicTask,root:c.root,allowedWritePaths:c.allowedWritePaths,venv:c.venv,env:expected,native:{cellDir:c.cellDir,binding,bridge}});}catch(error){onFatal(error);lane.destroy();throw error;}
  const created=session;
  return {packet:created.packet,get fatalReason(){return created.fatalReason;},dispatch:created.dispatch,
   async close(){try{await created.close();if(firstFatal)throw firstFatal;await lane.close(created.verifyNativeEvidence());}catch(error){onFatal(error);lane.destroy();throw error;}}};
 },
 onSubmit:async()=>({provisional:true}),
});
const fd=fs.openSync(path.join(c.cellDir,'worker-outcome.json'),'wx',0o600);
try{fs.writeFileSync(fd,JSON.stringify(outcome)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
process.exitCode=outcome.status==='submitted'?0:1;
