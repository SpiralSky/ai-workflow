import path from 'node:path';
import {inventory,assertPermittedDelta,readBounded,type FileIdentity} from './files.mjs';
import {digest,LIMITS} from './protocol.mjs';

/** Current permitted workspace reads, including allowed edits/new files; never a frozen content cache. */
export function createCurrentWorkspaceReader(options:{
 root:string; original:Record<string,FileIdentity>; allowedWritePaths:string[];
 onRead:(record:Record<string,unknown>)=>void; onFatal:(error:unknown)=>Error;
}) {
 const root=path.resolve(options.root);
 /** Validate containment, every current entry and protected-file deltas before touching a target. */
 const inspect=(value:string)=>{
  if(typeof value!=='string'||!value||value.includes('\\')||value.includes('\0')||path.isAbsolute(value)||value.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('unsafe reference path');
  const current=inventory(root);assertPermittedDelta(options.original,current,options.allowedWritePaths);
  return {relative:value,file:path.join(root,value),current};
 };
 /** Record exact bytes actually used by reference resolution, with a finite text ceiling. */
 const read=(value:string,required:boolean)=>{
  try {
   const before=inspect(value),entry=before.current[before.relative];
   if(!entry){options.onRead({operation:required?'readFile':'pathExists',path:value,exists:false});if(required)throw Error('reference file missing');return undefined;}
   const bytes=readBounded(before.file,LIMITS.referenceReadBytes);
   const content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   const after=inspect(value),later=after.current[after.relative];
   if(!later||JSON.stringify(entry)!==JSON.stringify(later)||digest(bytes)!==later.sha256)throw Error('reference changed during read');
   options.onRead({operation:required?'readFile':'pathExists',path:value,exists:true,sha256:digest(bytes),bytes:bytes.length,content});
   return content;
  }catch(error){throw options.onFatal(error);}
 };
 return {reader:{async readFile(value:string){return read(value,true)!;}},pathExists:async(value:string)=>read(value,false)!==undefined};
}
