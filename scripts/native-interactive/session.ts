import {LIMITS,LOCAL_WATCHDOGS} from './protocol.mjs';
import {NATIVE_COMPLETION_LIMITS} from './native-completion.mjs';
import {inspectCheckRuntime,nativeCheckEnv} from './check-runtime.mjs';
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
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {Request} from '@modelcontextprotocol/sdk/types.js';
import {createHostLLMClient} from '../../packages/server/src/host-client.ts';
import {installHostLLMBroker,type HostLLMAdmission} from '../../packages/runner/src/llm-broker.ts';
import {createCurrentWorkspaceReader} from './current-workspace.ts';
import {createNativeEventSink} from './native-events.mjs';
import type {createNativeCompletionBridge} from './native-completion.mjs';

export const NATIVE_MODEL_LABEL='native-harness-unreported';
export interface NativeSessionOptions {
 cellDir:string;
 binding:{sourceSHA256:string;admissionSHA256:string;cellId:string;arm:string;limitsSHA256:string};
 bridge:ReturnType<typeof createNativeCompletionBridge>;
}


export const CATALOG = ['readFile','writeFile','edit','grep','findFiles','listDir','multiEdit','findDefinition','findReferences','check','runTests'] as const;
export interface SessionOptions {
  arm:'direct'|'branch-expanded'|'branch-hotpath2'|'orchestrate-off'|'orchestrate-on'; publicTask?:string; root:string; allowedWritePaths:string[]; venv:string; env:NodeJS.ProcessEnv;
  onHostAttempt:(name:string,args:unknown)=>void;
  onHostResult?:(event:unknown)=>void;
  timeoutMs?:number;
  native?:NativeSessionOptions;
  onFatal?:(error:Error)=>void;
}
/** Relative canonical POSIX path. This policy intentionally rejects aliases rather than normalizing them. */
function relative(value:unknown, directory=false):string {
 if(typeof value!=='string' || value.includes('\\') || value.includes('\0') || path.isAbsolute(value))throw new Error('unsafe path');
 if(directory && value==='.')return value;
 if(!value || value.split('/').some(x=>!x || x==='.' || x==='..'))throw new Error('unsafe path');
 return value;
}
/** Finite checked-host session; native orchestrate uses only the explicitly injected bounded bridge. */
export async function createNativeSession(opts:SessionOptions) {
 const orchestrate=opts.arm==='orchestrate-off'||opts.arm==='orchestrate-on';
 if(opts.arm!=='direct' && opts.arm!=='branch-expanded'&&opts.arm!=='branch-hotpath2'&&!orchestrate)throw new Error('unavailable arm');
 if(orchestrate!==Boolean(opts.native))throw new Error('explicit native orchestrate bridge required');
 if(opts.native&&opts.native.binding.arm!==opts.arm)throw new Error('native session arm mismatch');
 const actionMs=opts.timeoutMs??LIMITS.actionMs;
 if(!Number.isSafeInteger(actionMs)||actionMs<1||actionMs>LIMITS.actionMs)throw new Error('invalid or widening session timeout');
 const branchMs=Math.min(actionMs,LOCAL_WATCHDOGS.branchExecutionMs);
 const root=path.resolve(opts.root);
 if(fs.realpathSync(root)!==root || !fs.lstatSync(root).isDirectory())throw new Error('noncanonical root');
 const allowed=new Set(opts.allowedWritePaths.map(p=>relative(p)));
 const original=inventory(root);let failure:string|undefined;let closed=false;let busy=false;
 let admission:HostLLMAdmission|undefined;
 const fail=(e:unknown)=>{
  if(failure===undefined){failure=e instanceof Error?e.message:String(e);admission?.close();try{opts.onFatal?.(new Error(failure));}catch{/* The original failure remains authoritative. */}}
  return new Error(failure);
 };
 const checkFatal=()=>{if(opts.native?.bridge.failed)throw fail(opts.native.bridge.fatalReason??'native completion failed');if(failure)throw fail(failure);};
 const checkTree=()=>{
  try {assertPermittedDelta(original,inventory(root),[...allowed]);
  }catch(e){throw fail(e);}
 };
 const permittedEnv=new Set(['PATH','HOME','TMPDIR','LANG','LC_ALL','AIW_VENV','PYTHONDONTWRITEBYTECODE','PYTHONIOENCODING','AIW_OFFLINE_CHECKS','AIW_CHECK_RUNTIME']);
 for(const key of Object.keys(opts.env))if(!permittedEnv.has(key))throw new Error('nonminimal environment');
 if(opts.env.AIW_VENV!==opts.venv || opts.env.PYTHONDONTWRITEBYTECODE!=='1')throw new Error('explicit venv/no-bytecode environment required');
 if(opts.env.AIW_OFFLINE_CHECKS!=='1'||!opts.env.AIW_CHECK_RUNTIME||!opts.env.HOME)throw new Error('native offline checker binding required');
 const checkRuntime=JSON.parse(opts.env.AIW_CHECK_RUNTIME);
 const expectedEnv=nativeCheckEnv({venv:opts.venv},opts.env.HOME,checkRuntime);
 if(Object.keys(opts.env).sort().join(',')!==Object.keys(expectedEnv).sort().join(',')||Object.entries(expectedEnv).some(([key,value])=>opts.env[key]!==value))throw new Error('native checker environment mismatch');
 inspectCheckRuntime(opts.venv,opts.env.HOME,checkRuntime);
 const sidecar=new Sidecar({root,env:{...opts.env}});
 const local=new LocalHost('L',{root,sidecar});
 let closing:Promise<void>|undefined;
 let brokerClient:Client|undefined,brokerServer:Server<Request>|undefined;
 let eventSink:ReturnType<typeof createNativeEventSink>|undefined;
 const closeResources=()=>closing??=(async()=>{
  admission?.close();
  try{await brokerClient?.close();}finally{try{await brokerServer?.close();}finally{try{await sidecar.close();}finally{await local.close();}}}
 })();
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
 if(opts.native)eventSink=createNativeEventSink({cellDir:opts.native.cellDir,binding:opts.native.binding,onFatal:fail,completionEvidence:()=>opts.native!.bridge.verifyComplete()});
 const reporter=createReporter({writer:'r',sink:eventSink??{write(){}}});
 const readers=createCurrentWorkspaceReader({root,original,allowedWritePaths:[...allowed],onFatal:fail,onRead:record=>reporter.attach('native.workspace-read',record)});
 let hostClient;
 if(opts.native){
  brokerClient=new Client({name:'native-orchestrate-host',version:'1'},{capabilities:{experimental:{'aiw/llm/complete':{}}}});
  brokerServer=new Server<Request>({name:'native-orchestrate-session',version:'1'});
  admission=installHostLLMBroker(brokerClient,{secondaryClient:opts.native.bridge.client,secondaryModel:NATIVE_MODEL_LABEL,nativeMode:true});
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
  await Promise.all([brokerClient.connect(clientTransport),brokerServer.connect(serverTransport)]);
  const server=brokerServer;
  const transportClient=createHostLLMClient(()=>server,{timeoutMs:Math.min(actionMs,NATIVE_COMPLETION_LIMITS.requestMs),nativeMode:{model:NATIVE_MODEL_LABEL}});
  // Integrity faults outside the adapter must survive the engine's normal error result.
  hostClient={async complete(request:Parameters<typeof transportClient.complete>[0]){
   try{return await transportClient.complete(request);}catch(error){throw fail(error);}
  }};
 }
 const framework=buildFramework(orchestrate?'orchestrate':opts.arm==='direct'?'baseline':'branch-only',registry,{
  host:checked,timeoutMs:branchMs,memoryMb:128,
  ...(hostClient?{variant:{hotPaths:opts.arm==='orchestrate-on'},orchestrate:{client:hostClient,model:NATIVE_MODEL_LABEL,rerankModel:NATIVE_MODEL_LABEL,workspaceRoot:root,...readers}}:{}),
 });
 const examples=opts.arm==='branch-hotpath2'?await selectHotpathExamples(opts.publicTask??'',registry.decls):undefined;
 if(opts.native){checkTree();opts.native.bridge.open();admission!.open();}
 /** Independent receipts and durable role coverage must both agree before accepting a result. */
 const verifyNativeEvidence=()=>{
  checkFatal();
  if(!opts.native||!eventSink)throw Error('not a native orchestrate session');
  try{return {completion:opts.native.bridge.verifyComplete(),event:eventSink.verifyComplete()};}catch(error){throw fail(error);}
 };
 let finalClose:Promise<void>|undefined;
 return {
  packet:{task:opts.publicTask??'',allowedWritePaths:[...opts.allowedWritePaths],...(examples?{hotpathExamples:examples}:{}),instructions:framework.instructions,tools:framework.tools.map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema})),fingerprint:framework.fingerprint,...(opts.native?{nativeSource:opts.native.binding.sourceSHA256,hotPaths:opts.arm==='orchestrate-on',usageStatus:'unavailable'}:{})},
  get failed(){return failure!==undefined||Boolean(opts.native?.bridge.failed);},
  get fatalReason(){return failure??opts.native?.bridge.fatalReason;},
  fail,
  verifyNativeEvidence,
  async dispatch(action:{kind:string;sequence?:number;args?:Record<string,unknown>;calls?:{name:string;args:Record<string,unknown>}[];code?:string},signal?:AbortSignal){
   checkFatal();if(closed||busy)throw fail('session unavailable');busy=true;
   try {
    checkTree();if(signal?.aborted)throw fail('aborted');
    const requests=opts.arm==='direct'&&action.kind==='tools'?action.calls:
     (opts.arm==='branch-expanded'||opts.arm==='branch-hotpath2')&&action.kind==='branch'?[{name:'branch',args:{code:action.code}}]:
     orchestrate&&(action.kind==='do'||action.kind==='resolve')&&action.args?[{name:action.kind,args:action.args}]:undefined;
    if(!requests?.length)throw fail('invalid session action');
    if(opts.native){if(!Number.isSafeInteger(action.sequence)||action.sequence!<1)throw fail('native action sequence required');opts.native.bridge.beginAction(action.sequence!,actionMs);}
    const results=[];
    for(const req of requests){
     if(signal?.aborted)throw fail('aborted');
     const tool=framework.tools.find(t=>t.name===req.name);if(!tool)throw fail('unavailable tool');
     const result=await tool.handle(req.args,{reporter,signal});
     checkFatal();if(closed||signal?.aborted)throw fail('closed or aborted');checkTree();results.push(result);
    }
    opts.native?.bridge.endAction();return results;
   }catch(error){if(opts.native)throw fail(error);throw error;}
   finally{busy=false;}
  },
  close(){
   if(finalClose)return finalClose;
   closed=true;if(busy)fail('closed during action');
   finalClose=(async()=>{
    try {
     if(opts.native){checkFatal();opts.native.bridge.close();eventSink!.close();verifyNativeEvidence();}
    }catch(error){fail(error);}
    finally{try{await closeResources();}catch(error){throw fail(error);}}
    if(opts.native)checkFatal();
   })();return finalClose;
  }
 };
 }catch(error){fail(error);try{opts.native?.bridge.close();}catch{/* Preserve original setup failure. */}try{await closeResources();}catch(cleanup){throw new AggregateError([error,cleanup],'session initialization and cleanup failed');}throw error;}
}
