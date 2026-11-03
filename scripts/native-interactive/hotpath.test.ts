import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL}from 'node:url';
import {LocalHost}from '../../packages/server/src/local.ts';import {buildRegistry}from '../../packages/core/src/registry/registry.ts';
import {CATALOG}from './session.ts';import {selectHotpathExamples}from './hotpath.ts';import {hotpathBinding,HOTPATH_ROOT,HOTPATH_COMMIT,HOTPATH_TREE,inspectRuntime,assertFlatSourceResolution}from './hotpath-source.mjs';
async function declarations(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-hotpath-catalog-'));const host=new LocalHost('L',{root});try{return buildRegistry((await host.tools()).filter(t=>CATALOG.includes(t.name as typeof CATALOG[number])),{warn(){}}).decls;}finally{await host.close();}}
test('real recovered index selection matches authentic order and exact snippets without network',async t=>{
 const fetch=t.mock.method(globalThis,'fetch',async()=>{throw Error('network forbidden in local selection');});
 const catalog=await declarations(),original=structuredClone(catalog),task='Check a changed file for type and lint errors; inspect the bounded line window and read diagnostics.';
 const packet=await selectHotpathExamples(task,catalog);
 const {HotPathIndex}=await import(pathToFileURL(path.join(HOTPATH_ROOT,'packages/core/src/orchestrate/hot-paths/index.ts')).href);
 const {HOT_PATH_SEEDS}=await import(pathToFileURL(path.join(HOTPATH_ROOT,'packages/core/src/orchestrate/hot-paths/catalog.ts')).href);
 const expected=new HotPathIndex(HOT_PATH_SEEDS).select(task,{tools:catalog,stages:{retrieved:[],final:catalog.map(t=>t.name)}},catalog).hotPaths;
 assert.deepEqual(packet.snippets,expected);assert.ok(packet.snippets.length>0&&packet.snippets.length<=2);assert.deepEqual(catalog,original);assert.equal(fetch.mock.callCount(),0);assert.equal(packet.source.commit,HOTPATH_COMMIT);assert.equal(packet.source.tree,HOTPATH_TREE);
});
test('genuine zero retrieval is recorded without fallback or handpicked examples',async()=>{const packet=await selectHotpathExamples('zzzzunmatchabletokenzzzz',await declarations());assert.deepEqual(packet.snippets,[]);assert.deepEqual(packet.selected,[]);assert.equal(packet.zeroSelection,true);});
test('fixed runtime identity is real and mismatched identities rejected before module loading',()=>{const binding=hotpathBinding();assert.equal(binding.commit,HOTPATH_COMMIT);assert.ok(Object.keys(binding.source).length>0);assert.ok(binding.dependencies.tsx);assert.throws(()=>inspectRuntime(HOTPATH_ROOT,'0'.repeat(40),HOTPATH_TREE),/identity/);});
test('ignored source-local dependency shadow is rejected, not silently resolved',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-flat-resolution-'));const rel='packages/core/src/file.ts';fs.mkdirSync(path.dirname(path.join(root,rel)),{recursive:true});assert.doesNotThrow(()=>assertFlatSourceResolution(root,[rel]));fs.mkdirSync(path.join(root,'packages/core/node_modules'));assert.throws(()=>assertFlatSourceResolution(root,[rel]),/shadow/);});
