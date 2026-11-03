import os from 'node:os';
import {isDeepStrictEqual} from 'node:util';
import {readBounded} from './files.mjs';
import {digest} from './protocol.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const PYTHON_DIR=path.resolve(import.meta.dirname,'../../packages/tools/python');
/** Select only the already-running, canonical Node executable, never inherited PATH. */
export function verifiedNode(executable=process.execPath){
 const canonical=fs.realpathSync(executable);
 if(!path.isAbsolute(executable)||path.resolve(executable)!==executable||canonical!==executable||path.basename(canonical)!=='node'||!fs.lstatSync(canonical).isFile())throw Error('offline check runtime: noncanonical Node executable');
 fs.accessSync(canonical,fs.constants.X_OK);
 return canonical;
}
/** Explicit child environment. The native marker never comes from the parent environment. */
export function nativeCheckEnv(c,temp,runtime){
 const node=verifiedNode();
 if(runtime&&runtime.node?.path!==node)throw Error('offline check runtime: bound Node mismatch');
 return {PATH:`${path.dirname(node)}:/usr/local/bin:/usr/bin:/bin`,HOME:temp,TMPDIR:temp,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',AIW_VENV:c.venv,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8',AIW_OFFLINE_CHECKS:'1',...(runtime?{AIW_CHECK_RUNTIME:JSON.stringify(runtime)}:{})};
}
/** Validate the existing Python/Node/JS closure before any native worker starts. No installation. */
export function inspectCheckRuntime(venv,temp,expected,timeoutMs=30000){
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>30000)throw Error("offline check runtime: invalid preflight timeout");
 const node=verifiedNode();
 const env={...nativeCheckEnv({venv},temp),PYTHONPATH:PYTHON_DIR};
 try{
  const output=execFileSync(path.join(venv,'bin/python'),['-m','aiw_sidecar.offline_check',node],{cwd:PYTHON_DIR,env,input:expected?JSON.stringify(expected):'',encoding:'utf8',timeout:Math.max(1,Math.floor(timeoutMs)),maxBuffer:16384});
  const runtime=JSON.parse(output);
  if(runtime.venv!==venv||runtime.node?.path!==node)throw Error('unexpected runtime identity');
  return runtime;
 }catch(error){throw Error(`offline check runtime preflight failed: ${String(error.stderr??error.message).slice(-1000)}`);}
}
/** Immutable, reviewed environment lock, included in frozen campaign and admission lineage. */
export function checkRuntimePolicy(){
 const bytes=readBounded(path.join(PYTHON_DIR,'aiw_sidecar/offline_check_runtime.json'),16384);
 const lock=JSON.parse(bytes.toString('utf8'));
 if(lock.mode!=='native-offline-bundled-pyright-v1')throw Error('offline check runtime: invalid policy');
 return {mode:lock.mode,lockSHA256:digest(bytes)};
}
/** Verify retained runtime bytes, start/result linkage, pinned policy and current installed closure. */
export function verifyCellCheckRuntime({cellDir,admission,supervision}){
 const policy=checkRuntimePolicy();
 if(!isDeepStrictEqual(admission.checkRuntimePolicy,policy))throw Error('offline check runtime: admission policy changed');
 const bytes=readBounded(path.join(cellDir,'check-runtime.json'),16384),sha256=digest(bytes);
 const start=JSON.parse(readBounded(path.join(cellDir,'supervisor-start.json'),16384).toString('utf8'));
 if(start.checkRuntimeSHA256!==sha256||supervision.checkRuntimeSHA256!==sha256||!isDeepStrictEqual(start.checkRuntimePolicy,policy))throw Error('offline check runtime: final evidence changed');
 const preflightBytes=readBounded(path.join(cellDir,'check-runtime-preflight.json'),16384),preflight=JSON.parse(preflightBytes.toString('utf8'));
 if(start.checkRuntimePreflightSHA256!==digest(preflightBytes)||supervision.checkRuntimePreflightSHA256!==digest(preflightBytes)||preflight.status!=='passed'||!isDeepStrictEqual(preflight.runtimePolicy,policy))throw Error('offline check runtime: preflight evidence changed');
 const runtime=JSON.parse(bytes.toString('utf8'));
 if(runtime.sources?.['offline_check_runtime.json']?.sha256!==policy.lockSHA256)throw Error('offline check runtime: lock binding changed');
 inspectCheckRuntime(admission.config.venv,os.tmpdir(),runtime);
 return sha256;
}
