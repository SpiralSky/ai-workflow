import path from 'node:path';import {pathToFileURL}from 'node:url';import {isDeepStrictEqual}from 'node:util';
import type {ToolDecl}from '../../packages/core/src/registry/types.ts';
import {hotpathBinding,HOTPATH_ROOT}from './hotpath-source.mjs';
import {digest}from './protocol.mjs';
/** Genuine recovered retrieval, presented as examples only: all real tools already exist in every arm. */
export async function selectHotpathExamples(task:string,catalog:ToolDecl[]){
 if(typeof task!=='string'||!task.trim()||Buffer.byteLength(task)>32768)throw Error('invalid public task');
 const before=hotpathBinding();
 const load=(relative:string)=>import(pathToFileURL(path.join(HOTPATH_ROOT,relative)).href);
 const {HotPathIndex,MAX_HOT_PATHS}=await load('packages/core/src/orchestrate/hot-paths/index.ts');
 const {HOT_PATH_SEEDS}=await load('packages/core/src/orchestrate/hot-paths/catalog.ts');
 const {hotPathCatalogFingerprint}=await load('packages/core/src/orchestrate/hot-paths/fingerprint.ts');
 if(!isDeepStrictEqual(before,hotpathBinding())||MAX_HOT_PATHS!==2)throw Error('candidate source changed or wrong genuine cap');
 const original=structuredClone(catalog),selection={tools:catalog,stages:{retrieved:[],final:catalog.map(t=>t.name)}};
 const result=new HotPathIndex(HOT_PATH_SEEDS).select(task,selection,catalog);
 if(!isDeepStrictEqual(catalog,original)||!isDeepStrictEqual(result.selection.tools,original))throw Error('presentation pilot changed tool capabilities/order');
 const snippets=structuredClone(result.hotPaths);
 return {scope:'authentic-hotpath2-retrieval-presentation-only',source:{commit:before.commit,tree:before.tree,bindingSHA256:digest(before)},catalogSHA256:hotPathCatalogFingerprint(HOT_PATH_SEEDS),taskSHA256:digest(task),snippets,selected:snippets.map((s:{id:string;code:string})=>({id:s.id,codeSHA256:digest(s.code)})),zeroSelection:snippets.length===0};
}
