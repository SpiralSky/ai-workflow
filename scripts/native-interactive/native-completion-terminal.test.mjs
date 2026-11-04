import test from 'node:test';
import assert from 'node:assert/strict';
import {configureNativeCompletionTerminal} from './native-completion-capture.mjs';
const ok=()=>({status:0,signal:null,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)});
/** These fixed injected results never start a utility, actor, provider, or capture helper. */
test('pipe mode invokes no terminal utility and produces no diagnostic',()=>{
 configureNativeCompletionTerminal({inputTTY:false,outputTTY:false,run(){assert.fail('unexpected terminal utility');},diagnostic(){assert.fail('unexpected diagnostic');}});
});
test('TTY setup uses only the exact fixed utility arguments and bounded silent policy',()=>{
 let calls=0;
 configureNativeCompletionTerminal({inputTTY:true,outputTTY:true,run(...args){calls++;assert.deepEqual(args,['/usr/bin/stty',['-onlcr'],{stdio:[1,'pipe','pipe'],shell:false,timeout:1000,killSignal:'SIGKILL',maxBuffer:1024}]);return ok();},diagnostic(){assert.fail('unexpected diagnostic');}});
 assert.equal(calls,1);
});
for(const [inputTTY,outputTTY] of [[true,false],[false,true]])test('mixed TTY mode fails closed '+inputTTY+'/'+outputTTY,()=>{
 assert.throws(()=>configureNativeCompletionTerminal({inputTTY,outputTTY,run(){assert.fail('must not execute');}}),/mixed terminal streams/);
});
for(const [name,change] of [
 ['nonzero exit',{status:1}],['spawn error',{error:Object.assign(Error('missing fixed utility'),{code:'ENOENT'})}],
 ['signal',{status:null,signal:'SIGTERM'}],['timeout',{status:null,signal:'SIGKILL',error:Object.assign(Error('bounded setup timeout'),{code:'ETIMEDOUT'})}],
 ['stdout',{stdout:Buffer.from('unexpected\r\n')}],['stderr',{stderr:Buffer.from('diagnostic\r\n')}],
])test('setup '+name+' prevents capture and preserves exact diagnostics',()=>{
 const result={...ok(),...change},records=[];let captureStarted=false;
 assert.throws(()=>{configureNativeCompletionTerminal({inputTTY:true,outputTTY:true,run(){return result;},diagnostic:raw=>records.push(raw)});captureStarted=true;},/terminal setup failed/);
 assert.equal(captureStarted,false);assert.equal(records.length,1);
 const record=JSON.parse(records[0]);assert.equal(record.kind,'native-completion-terminal-setup-failed');
 assert.deepEqual(Buffer.from(record.stdoutBase64,'base64'),result.stdout);assert.deepEqual(Buffer.from(record.stderrBase64,'base64'),result.stderr);
 assert.equal(record.status,result.status);assert.equal(record.signal,result.signal);assert.equal(record.error?.code??null,result.error?.code??null);
});
test('a thrown setup launch fails closed with its error retained',()=>{
 const records=[];assert.throws(()=>configureNativeCompletionTerminal({inputTTY:true,outputTTY:true,run(){throw Object.assign(Error('launch failed'),{code:'EIO'});},diagnostic:raw=>records.push(raw)}),/terminal setup failed/);
 assert.equal(JSON.parse(records[0]).error.code,'EIO');
});
