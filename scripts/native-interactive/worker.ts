import fs from 'node:fs';
import path from 'node:path';
import {readConfig,sanitizedEnv,writeStream} from './cli.mjs';
import {runCell} from './controller.mjs';
import {readBounded,Journal} from './files.mjs';
import {digest}from './protocol.mjs';
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
const outcome=await runCell({arm:c.arm,input:process.stdin,emit:(line:string)=>writeStream(process.stdout,line),journal,
 createSession:(callbacks)=>createNativeSession({...callbacks,arm:c.arm,publicTask,root:c.root,allowedWritePaths:c.allowedWritePaths,venv:c.venv,env:expected}),
 onSubmit:async()=>({provisional:true}),
});
const fd=fs.openSync(path.join(c.cellDir,'worker-outcome.json'),'wx',0o600);
try{fs.writeFileSync(fd,JSON.stringify(outcome)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
process.exitCode=outcome.status==='submitted'?0:1;
