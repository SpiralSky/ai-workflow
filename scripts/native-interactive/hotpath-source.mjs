import fs from 'node:fs';import path from 'node:path';import {execFileSync}from 'node:child_process';import {createHash}from 'node:crypto';
import {readBounded}from './files.mjs';import {digest}from './protocol.mjs';
export const HOTPATH_COMMIT='8dcf05bad0c0f7c806db3d7350060435018773f8';
export const HOTPATH_TREE='cb1c1564f02f493bd9bb7cb10b7e9180a136d4a6';
export const HOTPATH_ROOT=path.resolve(import.meta.dirname,'../../../ai-workflow-native-hotpath-runtime');
const scope=['packages/core/src','packages/llm/src','packages/telemetry/src','package.json','package-lock.json','packages/core/package.json','packages/llm/package.json','packages/telemetry/package.json'];
function entryExists(file){try{fs.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
/** Reject source-local dependency shadows; actual loading must resolve only the pinned flat root closure. */
export function assertFlatSourceResolution(root,paths){
 const parents=new Set();for(const rel of paths){let dir=path.dirname(path.join(root,rel));while(dir!==root){if(!dir.startsWith(root+path.sep))throw Error('source escapes runtime');parents.add(dir);dir=path.dirname(dir);}}
 for(const dir of parents)if(entryExists(path.join(dir,'node_modules')))throw Error('source-local dependency shadow');
}
/** Read-only source admission. No module executes here; production callers cannot choose a runtime root. */
export function inspectRuntime(root,commit,tree){
 if(path.resolve(root)!==root||fs.realpathSync(root)!==root)throw Error('noncanonical runtime root');
 if(!/^[a-f0-9]{40}$/.test(commit)||!/^[a-f0-9]{40}$/.test(tree))throw Error('invalid source identity');
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:8388608});
 if(git('rev-parse','--show-toplevel').trim()!==root||git('rev-parse','HEAD').trim()!==commit||git('rev-parse','HEAD^{tree}').trim()!==tree||git('status','--porcelain','--untracked-files=normal').trim())throw Error('runtime identity or clean-tree mismatch');
 const source={};for(const row of git('ls-tree','-r','-z',tree,'--',...scope).split('\0').filter(Boolean)){
  const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);if(!match)throw Error('unsupported source entry');
  const [,mode,oid,rel]=match,filename=path.join(root,rel),bytes=readBounded(filename,8388608);
  const observed=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if(observed!==oid||((fs.statSync(filename).mode&0o111)?'100755':'100644')!==mode)throw Error('runtime working bytes/mode differ');source[rel]=digest(bytes);
 }
 if(!Object.keys(source).length)throw Error('empty source inventory');
 assertFlatSourceResolution(root,Object.keys(source));
 const lock=JSON.parse(readBounded(path.join(root,'package-lock.json'))),dependencies={},seen=new Set();let total=0,count=0,directories=0;
 function dependency(name){
  if(seen.has(name))return;seen.add(name);if(!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name))throw Error('invalid dependency name');
  const dir=path.join(root,'node_modules',name);if(fs.realpathSync(dir)!==dir)throw Error('nonlocal dependency');
  const manifest=JSON.parse(readBounded(path.join(dir,'package.json')));if(manifest.version!==lock.packages['node_modules/'+name]?.version)throw Error('dependency version mismatch');
  const files={};function walk(base,prefix='',depth=0){if(++directories>20000||depth>32)throw Error('dependency directory/depth limit');for(const entry of fs.readdirSync(base,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1)){const rel=prefix?`${prefix}/${entry.name}`:entry.name,file=path.join(base,entry.name);if(entry.isDirectory()){if(entry.name==='node_modules')throw Error('nested dependency override');if(fs.realpathSync(file)!==file)throw Error('dependency directory alias');walk(file,rel,depth+1);}else{if(!entry.isFile()||++count>20000)throw Error('unsupported dependency entry');const bytes=readBounded(file,33554432);total+=bytes.length;if(total>134217728)throw Error('dependency closure oversized');files[rel]={sha256:digest(bytes),mode:fs.statSync(file).mode&0o777};}}}walk(dir);
  dependencies[name]={version:manifest.version,files};for(const dep of Object.keys(manifest.dependencies??{}))dependency(dep);for(const dep of Object.keys(manifest.optionalDependencies??{}))if(fs.existsSync(path.join(root,'node_modules',dep)))dependency(dep);
 }
 for(const name of ['zod','jose','tsx'])dependency(name);
 for(const name of ['core','llm','telemetry'])if(fs.realpathSync(path.join(root,'node_modules/@aiw',name))!==path.join(root,'packages',name))throw Error('foreign workspace dependency');
 if(git('rev-parse','HEAD').trim()!==commit||git('status','--porcelain','--untracked-files=normal').trim())throw Error('runtime changed during admission');
 return {commit,tree,nodeVersion:process.version,source,dependencies};
}
export function hotpathBinding(){return inspectRuntime(HOTPATH_ROOT,HOTPATH_COMMIT,HOTPATH_TREE);}
