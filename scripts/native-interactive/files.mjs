import fs from 'node:fs';
import path from 'node:path';
import {digest} from './protocol.mjs';
/** Canonical regular-file inventory for a prepared fixture; rejects link/special-file inputs. */
export function inventory(root, {maxFiles=200,maxBytes=1048576}={}) {
 if(fs.realpathSync(root)!==path.resolve(root))throw new Error('noncanonical root');
 const out={};let total=0,entries=0;
 function walk(dir, rel='') {
  if(fs.realpathSync(dir)!==dir || rel.split('/').length>16)throw new Error('noncanonical/deep directory');
  for(const name of fs.readdirSync(dir).sort()) {
   const file=path.join(dir,name), key=rel?`${rel}/${name}`:name;
   if(++entries>500)throw new Error('fixture entry limit');
   if(fs.realpathSync(file)!==file)throw new Error('noncanonical entry');
   const before=fs.lstatSync(file);
   if(before.isSymbolicLink())throw new Error('link forbidden');
   if(before.isDirectory()){walk(file,key);continue;}
   if(!before.isFile() || before.nlink!==1)throw new Error('special/hardlink forbidden');
   if(Object.keys(out).length>=maxFiles || (total+=before.size)>maxBytes)throw new Error('fixture size limit');
   const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
   try {
    const opened=fs.fstatSync(fd);if(!opened.isFile() || opened.mode!==before.mode || opened.size!==before.size || opened.ino!==before.ino || opened.dev!==before.dev || opened.nlink!==1)throw new Error('unstable input');
    const buffer=Buffer.alloc(before.size+1);let used=0;
    while(used<buffer.length){const n=fs.readSync(fd,buffer,used,buffer.length-used,null);if(!n)break;used+=n;}
    const data=buffer.subarray(0,used),after=fs.fstatSync(fd);
    if(after.size!==before.size || after.mtimeMs!==before.mtimeMs || after.ctimeMs!==before.ctimeMs || after.mode!==before.mode || data.length!==before.size)throw new Error('unstable input');
    out[key]={sha256:digest(data),bytes:data.length,mode:before.mode & 0o777};
   } finally {fs.closeSync(fd);}
  }
 }
 walk(root);return out;
}
/** Reject changed/added/deleted files outside the exact allowed write set. */
export function assertPermittedDelta(before, after, allowed) {
 const set=new Set(allowed);
 for(const key of new Set([...Object.keys(before),...Object.keys(after)]))if(JSON.stringify(before[key])!==JSON.stringify(after[key])&&!set.has(key))throw new Error(`protected path changed: ${key}`);
}
/** Exclusive append-only event files, not tamperproof storage. Call before the reserved operation. */
export class Journal {
 #sequence=0;
 #failed=false;
 constructor(dir) {fs.mkdirSync(dir);this.dir=fs.realpathSync(dir);}
 append(event) {
  if(this.#failed)throw new Error('journal failed');
  try {
  const text=JSON.stringify(event)+'\n';
  const file=path.join(this.dir,String(this.#sequence+1).padStart(6,'0')+'.json');
  const fd=fs.openSync(file,'wx',0o600);
  try {fs.writeFileSync(fd,text);fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  const directory=fs.openSync(this.dir,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
  this.#sequence++;return {sequence:this.#sequence,sha256:digest(text)};
  } catch(e) {this.#failed=true;throw e;}
 }
}
/** Bounded stable read for coordinator metadata/copies; same quiescent, non-hostile-race scope as inventory. */
export function readBounded(file,maxBytes=1048576){
 if(fs.realpathSync(file)!==path.resolve(file))throw Error('noncanonical file');
 const before=fs.lstatSync(file);if(!before.isFile()||before.nlink!==1||before.size>maxBytes)throw Error('unsafe file');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const opened=fs.fstatSync(fd);if(!opened.isFile()||opened.nlink!==1||opened.ino!==before.ino||opened.dev!==before.dev||opened.mode!==before.mode||opened.size!==before.size)throw Error('unstable file');
 const buffer=Buffer.alloc(before.size+1);let used=0;while(used<buffer.length){const n=fs.readSync(fd,buffer,used,buffer.length-used,null);if(!n)break;used+=n;}
 const after=fs.fstatSync(fd);if(used!==before.size||after.size!==before.size||after.mode!==before.mode||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('unstable file');return buffer.subarray(0,used);
 }finally{fs.closeSync(fd);}
}
