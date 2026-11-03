import fs from 'node:fs';
import path from 'node:path';
import {selectHotpathExamples} from './hotpath.ts';
import {inventory,assertPermittedDelta} from './files.mjs';
import {buildFramework} from '../../packages/core/src/framework/build.ts';
import {buildRegistry} from '../../packages/core/src/registry/registry.ts';
import {CheckedHost} from '../../packages/core/src/host/checked.ts';
import type {Host} from '../../packages/core/src/host/types.ts';
import {LocalHost} from '../../packages/server/src/local.ts';
import {Sidecar} from '../../packages/tools/src/sidecar.ts';
import {createReporter} from '../../packages/telemetry/src/reporter.ts';

export const CATALOG = ['readFile','writeFile','edit','grep','findFiles','listDir','multiEdit','findDefinition','findReferences','check','runTests'] as const;
export interface SessionOptions {
  arm:'direct'|'branch-expanded'|'branch-hotpath2'; publicTask?:string; root:string; allowedWritePaths:string[]; venv:string; env:NodeJS.ProcessEnv;
  onHostAttempt:(name:string,args:unknown)=>void;
  onHostResult?:(event:unknown)=>void;
  timeoutMs?:number;
}
/** Relative canonical POSIX path. This policy intentionally rejects aliases rather than normalizing them. */
function relative(value:unknown, directory=false):string {
 if(typeof value!=='string' || value.includes('\\') || value.includes('\0') || path.isAbsolute(value))throw new Error('unsafe path');
 if(directory && value==='.')return value;
 if(!value || value.split('/').some(x=>!x || x==='.' || x==='..'))throw new Error('unsafe path');
 return value;
}
/** Real finite direct/branch session. No LLM transport, listener or automatic actor dispatch exists. */
export async function createNativeSession(opts:SessionOptions) {
 if(opts.arm!=='direct' && opts.arm!=='branch-expanded'&&opts.arm!=='branch-hotpath2')throw new Error('unavailable arm');
 const root=path.resolve(opts.root);
 if(fs.realpathSync(root)!==root || !fs.lstatSync(root).isDirectory())throw new Error('noncanonical root');
 const allowed=new Set(opts.allowedWritePaths.map(p=>relative(p)));
 const original=inventory(root);let failure:string|undefined;let closed=false;let busy=false;
 const fail=(e:unknown)=>{failure??=e instanceof Error?e.message:String(e);return new Error(failure);};
 const checkTree=()=>{
  try {assertPermittedDelta(original,inventory(root),[...allowed]);
  }catch(e){throw fail(e);}
 };
 const permittedEnv=new Set(['PATH','HOME','TMPDIR','LANG','LC_ALL','AIW_VENV','PYTHONDONTWRITEBYTECODE','PYTHONIOENCODING']);
 for(const key of Object.keys(opts.env))if(!permittedEnv.has(key))throw new Error('nonminimal environment');
 if(opts.env.AIW_VENV!==opts.venv || opts.env.PYTHONDONTWRITEBYTECODE!=='1')throw new Error('explicit venv/no-bytecode environment required');
 const sidecar=new Sidecar({root,env:{...opts.env}});
 const local=new LocalHost('L',{root,sidecar});
 let closing:Promise<void>|undefined;
 const closeResources=()=>closing??=(async()=>{try{await sidecar.close();}finally{await local.close();}})();
 try {
 const raw=await local.tools();
 const declarations=CATALOG.map(name=>{const d=raw.find(x=>x.name===name);if(!d)throw new Error(`missing real tool ${name}`);return d;});
 const subset:Host={tools:async()=>declarations,call:async(req,ctx)=>{
  if(failure||closed)throw fail(failure??'session closed');
  checkTree();if(ctx.signal.aborted)throw fail('aborted');
  const emit=(event:unknown)=>{try{opts.onHostResult?.(JSON.parse(JSON.stringify(event)));}catch(e){throw fail(e);}};
  const start=Date.now();
  try {const result=await local.call(req,ctx);checkTree();if(ctx.signal.aborted)throw fail('aborted');emit({name:req.name,ok:true,result,durationMs:Date.now()-start});return result;}
  catch(e){if(failure)throw fail(failure);checkTree();emit({name:req.name,ok:false,error:String(e),durationMs:Date.now()-start});throw e;}
 },close:closeResources};
 const checked=new CheckedHost(subset,{async check(call){
  try {
   opts.onHostAttempt(call.hostName,JSON.parse(JSON.stringify(call.args)));
   checkTree();if(!CATALOG.includes(call.name as typeof CATALOG[number]))throw new Error('unknown tool');
   const a=call.args as Record<string,unknown>;
   if(!a || typeof a!=='object' || Array.isArray(a))throw new Error('invalid args');
   const paths:unknown[]=[];
   if('path' in a)paths.push(a.path);
   if('symbol' in a){if(typeof a.symbol!=='string'||!a.symbol.includes('#'))throw new Error('invalid symbol');paths.push(a.symbol.split('#')[0]);}
   if('target' in a){if(typeof a.target!=='string')throw new Error('invalid target');paths.push(a.target.split('#')[0]);}
   if(call.name==='multiEdit') {if(!Array.isArray(a.edits)||!a.edits.length)throw new Error('invalid edits');for(const e of a.edits){if(!e||typeof e!=='object')throw new Error('invalid edit');paths.push(e.path);}}
   if(['writeFile','edit'].includes(call.name)&&!('path' in a))throw new Error('missing write path');
   for(const p of paths){const rel=relative(p,call.effect!=='write');if(call.effect==='write'&&!allowed.has(rel))throw new Error('write denied');}
   return {decision:'allow' as const};
  }catch(e){throw fail(e);}
 }},{session:()=>({sessionId:'native-fixture'})});
 const registry=buildRegistry(await checked.tools(),{warn:()=>{}});
 const framework=buildFramework(opts.arm==='direct'?'baseline':'branch-only',registry,{host:checked,timeoutMs:opts.timeoutMs??60000,memoryMb:128});
 const examples=opts.arm==='branch-hotpath2'?await selectHotpathExamples(opts.publicTask??'',registry.decls):undefined;
 const reporter=createReporter({writer:'r',sink:{write(){}}});
 return {
  packet:{task:opts.publicTask??'',allowedWritePaths:[...opts.allowedWritePaths],...(examples?{hotpathExamples:examples}:{}),instructions:framework.instructions,tools:framework.tools.map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema})),fingerprint:framework.fingerprint},
  get failed(){return failure!==undefined;},
  async dispatch(action:{kind:string;calls?:{name:string;args:Record<string,unknown>}[];code?:string},signal?:AbortSignal){
   if(failure||closed||busy)throw fail(failure??'session unavailable');busy=true;
   try {checkTree();if(signal?.aborted)throw fail('aborted');const requests=opts.arm==='direct'&&action.kind==='tools'?action.calls:(opts.arm==='branch-expanded'||opts.arm==='branch-hotpath2')&&action.kind==='branch'?[{name:'branch',args:{code:action.code}}]:undefined;
    if(!requests?.length)throw fail('invalid session action');
    const results=[];for(const req of requests){if(signal?.aborted)throw fail('aborted');const tool=framework.tools.find(t=>t.name===req.name);if(!tool)throw fail('unavailable tool');const result=await tool.handle(req.args,{reporter,signal});if(failure)throw fail(failure);if(closed||signal?.aborted)throw fail('closed or aborted');checkTree();results.push(result);}
    return results;
   }finally{busy=false;}
  },
  close(){closed=true;if(busy)fail('closed during action');return closeResources();}
 };
 }catch(error){try{await closeResources();}catch(cleanup){throw new AggregateError([error,cleanup],'session initialization and cleanup failed');}throw error;}
}
