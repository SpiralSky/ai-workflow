import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {inventory,assertPermittedDelta,Journal} from './files.mjs';
function temp(t){const p=fs.mkdtempSync(path.join(os.tmpdir(),'native-files-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return fs.realpathSync(p);}
test('inventory and exact writes preserve protected files',t=>{const p=temp(t);fs.writeFileSync(path.join(p,'a.py'),'a');const a=inventory(p);fs.writeFileSync(path.join(p,'a.py'),'b');const b=inventory(p);assert.throws(()=>assertPermittedDelta(a,b,[]));assert.doesNotThrow(()=>assertPermittedDelta(a,b,['a.py']));});
test('symlinks and multiply-linked files are refused',t=>{const p=temp(t);fs.writeFileSync(path.join(p,'a'),'x');fs.symlinkSync('a',path.join(p,'b'));assert.throws(()=>inventory(p));fs.unlinkSync(path.join(p,'b'));fs.linkSync(path.join(p,'a'),path.join(p,'b'));assert.throws(()=>inventory(p));});
test('size caps are enforced before reading payloads',t=>{const p=temp(t);fs.writeFileSync(path.join(p,'a'),'xx');assert.throws(()=>inventory(p,{maxBytes:1}));assert.throws(()=>inventory(p,{maxFiles:0}));});
test('journal creation and event files are exclusive',t=>{const p=path.join(temp(t),'events');const j=new Journal(p);assert.throws(()=>new Journal(p));assert.equal(j.append({reserved:1}).sequence,1);fs.writeFileSync(path.join(p,'000002.json'),'occupied');assert.throws(()=>j.append({reserved:2}));assert.equal(fs.readFileSync(path.join(p,'000002.json'),'utf8'),'occupied');});
test('growth after metadata read remains bounded and rejected',t=>{
 const p=temp(t),f=path.join(p,'a');fs.writeFileSync(f,'x');const original=fs.readSync;let changed=false,max=0;
 fs.readSync=function(fd,b,offset,length,position){max=Math.max(max,length);if(!changed){changed=true;fs.appendFileSync(f,'y'.repeat(4096));}return original(fd,b,offset,length,position);};
 try{assert.throws(()=>inventory(p));assert.ok(max<=2);}finally{fs.readSync=original;}
});
test('failed journal sync is sticky and does not retry uncertain reservation',t=>{
 const p=path.join(temp(t),'events'),j=new Journal(p),sync=fs.fsyncSync;fs.fsyncSync=()=>{throw new Error('injected sync error');};
 try{assert.throws(()=>j.append({reserved:1}));}finally{fs.fsyncSync=sync;}
 assert.throws(()=>j.append({reserved:2}),/journal failed/);assert.equal(fs.readdirSync(p).length,1);
});
test('bounded metadata reader rejects symlink/oversize and returns stable bytes',async()=>{const {readBounded}=await import('./files.mjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bounded-meta-')),p=path.join(dir,'file');fs.writeFileSync(p,'abc');assert.equal(readBounded(p).toString(),'abc');assert.throws(()=>readBounded(p,2));fs.symlinkSync(p,path.join(dir,'alias'));assert.throws(()=>readBounded(path.join(dir,'alias')));});
