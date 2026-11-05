import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nativeSharedClock,nativeRemainingLifetime,NativeClockSamplingError} from './native-completion.mjs';

const BOOT='01234567-89ab-cdef-0123-456789abcdef';
const LEASE={bootId:BOOT,issuedUptimeMs:1000,issuedWallMs:100000,expiresUptimeMs:1980,expiresWallMs:100980,remainingMs:1000};
const CLOCK={bootId:BOOT,uptimeMs:1100,wallUpperMs:100100};

/** Fully synthetic reads; any read beyond the original sequence fails. */
function syntheticSample(t,lower,upper){
 const reads=[];let wallReads=0;
 t.mock.method(Date,'now',()=>{reads.push('wall');assert.ok(wallReads<2);return wallReads++===0?lower:upper;});
 t.mock.method(fs,'readFileSync',(file,encoding)=>{
  assert.equal(encoding,'utf8');
  if(file==='/proc/sys/kernel/random/boot_id'){reads.push('boot');return BOOT;}
  if(file==='/proc/uptime'){reads.push('uptime');return '1.00 0.00';}
  assert.fail('unexpected clock file');
 });
 return reads;
}

for(const [name,lower,upper] of [
 ['NaN lower',NaN,1000],['NaN upper',1000,NaN],
 ['both positive infinity',Infinity,Infinity],['both negative infinity',-Infinity,-Infinity],
 ['coercible lower','1000',1000],['coercible upper',1000,'1000'],
 ['null lower',null,0],['undefined upper',1000,undefined],
 ['finite bounds with overflowing difference',-Number.MAX_VALUE,Number.MAX_VALUE],
])test('sampling rejects invalid wall observation: '+name,{skip:process.platform!=='linux'},t=>{
 const reads=syntheticSample(t,lower,upper);
 assert.throws(()=>nativeSharedClock(),NativeClockSamplingError);
 assert.deepEqual(reads,['wall','boot','uptime','wall']);
});

test('lifetime rejects nonfinite or coercible original and current numeric fields',()=>{
 for(const [target,fields] of [[LEASE,['issuedUptimeMs','issuedWallMs','expiresUptimeMs','expiresWallMs','remainingMs']],[CLOCK,['uptimeMs','wallUpperMs']]]){
  for(const field of fields)for(const value of [NaN,Infinity,-Infinity,null,undefined,'1000']){
   const lease=target===LEASE?{...LEASE,[field]:value}:LEASE;
   const clock=target===CLOCK?{...CLOCK,[field]:value}:CLOCK;
   assert.throws(()=>nativeRemainingLifetime(lease,clock),/native helper clock invalid/,field+'='+String(value));
  }
 }
});

test('lifetime rejects overflowing elapsed arithmetic even when remaining arithmetic is finite',()=>{
 const max=Number.MAX_VALUE;
 const lease={...LEASE,issuedUptimeMs:-max,issuedWallMs:-max,expiresUptimeMs:max,expiresWallMs:max,remainingMs:max};
 const clock={...CLOCK,uptimeMs:max/2,wallUpperMs:max/2};
 assert.throws(()=>nativeRemainingLifetime(lease,clock),/native helper clock invalid/);
});

test('lifetime rejects a remaining bound that overflows even when the other bound is finite',()=>{
 const max=Number.MAX_VALUE;
 const lease={...LEASE,issuedUptimeMs:-max,issuedWallMs:0,expiresUptimeMs:max,expiresWallMs:1000,remainingMs:1000};
 const clock={...CLOCK,uptimeMs:-max,wallUpperMs:0};
 assert.throws(()=>nativeRemainingLifetime(lease,clock),/native helper clock invalid/);
});

test('lifetime retains original finite deadlines and drift boundary',()=>{
 assert.equal(nativeRemainingLifetime(LEASE,CLOCK),880);
 assert.equal(nativeRemainingLifetime(LEASE,{...CLOCK,wallUpperMs:100160}),820);
 assert.throws(()=>nativeRemainingLifetime(LEASE,{...CLOCK,wallUpperMs:100161}),/elapsed drift/);
 assert.throws(()=>nativeRemainingLifetime(LEASE,{...CLOCK,uptimeMs:1980,wallUpperMs:100980}),/original completion deadline/);
 assert.throws(()=>nativeRemainingLifetime(LEASE,{...CLOCK,uptimeMs:999}),/backwards/);
 assert.throws(()=>nativeRemainingLifetime(LEASE,{...CLOCK,bootId:'other'}),/domain drift/);
});
