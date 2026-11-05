import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NativeClockSamplingError,nativeSharedClock,NATIVE_COMPLETION_CLOCK_POLICY} from './native-completion.mjs';

// Draft synthetic controls only. No helpers, engine, campaign, provider, subprocess, or live clock.
const BOOT='01234567-89ab-cdef-0123-456789abcdef';
const READ_ORDER=['wall','boot','uptime','wall'];

/** Replace every clock read with fixed synthetic values; unexpected reads fail rather than fall through. */
function mockClock(t,{lower=1000,upper=1000,uptime='1.00 0.00',boot=BOOT}={}){
 const calls=[];let walls=0;
 t.mock.method(Date,'now',()=>{calls.push('wall');assert.ok(walls<2,'no retry or extra wall read');return walls++===0?lower:upper;});
 t.mock.method(fs,'readFileSync',(file,encoding)=>{
  assert.equal(encoding,'utf8');
  if(file==='/proc/sys/kernel/random/boot_id'){calls.push('boot');return boot;}
  if(file==='/proc/uptime'){calls.push('uptime');return uptime;}
  assert.fail('unexpected file read in synthetic clock control');
 });
 return calls;
}

test('failure formatter is bounded and retains numeric primitives only',()=>{
 const values=[0,-1,20,21,Number.MAX_VALUE,-Number.MAX_VALUE,Number.MIN_VALUE,-Number.MIN_VALUE,NaN,Infinity,-Infinity];
 for(const uptimeMs of values)for(const samplingSkewMs of values){
  const error=new NativeClockSamplingError(uptimeMs,samplingSkewMs);
  assert.ok(error instanceof Error);
  assert.equal(error.message,'native helper clock sampling skew; uptimeMs='+String(uptimeMs)+'; samplingSkewMs='+String(samplingSkewMs)+'; limitMs=20');
  assert.ok(Buffer.byteLength(error.message)<=160);
  assert.equal(error.message.slice(0,1024),error.message);
  assert.equal(JSON.parse(JSON.stringify({reason:error.message})).reason,error.message);
 }
});

test('failure formatter never coerces strings, objects, or symbols into diagnostic text',()=>{
 const secret='UNTRUSTED_DIAGNOSTIC_SENTINEL';
 const object={toString(){assert.fail('object coercion');},valueOf(){assert.fail('object coercion');}};
 for(const value of [secret,object,Symbol(secret),null,undefined]){
  const error=new NativeClockSamplingError(value,value);
  assert.equal(error.message,'native helper clock sampling skew; uptimeMs=not-number; samplingSkewMs=not-number; limitMs=20');
  assert.equal(error.message.includes(secret),false);
 }
});

for(const skew of [0,20])test('successful synthetic sample preserves fields and ordered reads at skew '+skew,{skip:process.platform!=='linux'},t=>{
 const calls=mockClock(t,{upper:1000+skew});
 assert.deepEqual(nativeSharedClock(),{bootId:BOOT,uptimeMs:1000,wallMs:1000,wallUpperMs:1000+skew,samplingSkewMs:skew});
 assert.deepEqual(calls,READ_ORDER);
 assert.equal(NATIVE_COMPLETION_CLOCK_POLICY.samplingSkewMs,20);
});

for(const skew of [-1,21])test('rejected synthetic bracket retains value without retry at skew '+skew,{skip:process.platform!=='linux'},t=>{
 const calls=mockClock(t,{upper:1000+skew});
 assert.throws(()=>nativeSharedClock(),error=>{
  assert.ok(error instanceof NativeClockSamplingError);
  assert.equal(error.message,'native helper clock sampling skew; uptimeMs=1000; samplingSkewMs='+skew+'; limitMs=20');
  assert.equal(error.message.includes(BOOT),false);
  return true;
 });
 assert.deepEqual(calls,READ_ORDER);
});

test('nonfinite parsed uptime is retained as a fixed numeric token without source text',{skip:process.platform!=='linux'},t=>{
 const text='9'.repeat(400)+'.00 0.00',calls=mockClock(t,{uptime:text});
 assert.throws(()=>nativeSharedClock(),error=>{
  assert.ok(error instanceof NativeClockSamplingError);
  assert.equal(error.message,'native helper clock sampling skew; uptimeMs=Infinity; samplingSkewMs=0; limitMs=20');
  assert.equal(error.message.includes(text),false);
  return true;
 });
 assert.deepEqual(calls,READ_ORDER);
});

for(const input of [{uptime:'UNTRUSTED_CLOCK_TEXT'},{boot:'UNTRUSTED_BOOT_TEXT'}])test('synthetic malformed clock source keeps existing generic failure '+Object.keys(input)[0],{skip:process.platform!=='linux'},t=>{
 const calls=mockClock(t,input);
 assert.throws(()=>nativeSharedClock(),error=>{
  assert.equal(error instanceof NativeClockSamplingError,false);
  assert.equal(error.message,'native helper shared clock invalid');
  return true;
 });
 assert.deepEqual(calls,READ_ORDER);
});
