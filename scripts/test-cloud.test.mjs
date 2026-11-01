import assert from 'node:assert/strict';
import test from 'node:test';
import {findVenv,assertTestResult} from './test-cloud.mjs';

test('venv discovery prefers explicit environment and resolves relative paths', () => {
  assert.equal(findVenv('/repo',{AIW_VENV:'env'}, p => ['/repo/env/bin/python','/repo/packages/tools/.venv/bin/python'].includes(p)), '/repo/env');
});
test('venv discovery uses repository venv without a machine-specific path', () => {
  assert.equal(findVenv('/repo',{},p => p === '/repo/packages/tools/.venv/bin/python'), '/repo/packages/tools/.venv');
  assert.equal(findVenv('/repo',{},()=>false),undefined);
});
test('test result requires zero skips and successful exit', () => {
  assert.doesNotThrow(()=>assertTestResult({status:0,stdout:'# skipped 0\n'},'fixture'));
  assert.throws(()=>assertTestResult({status:0,stdout:'# skipped 2\n'},'fixture'),/skipped/);
  assert.throws(()=>assertTestResult({status:1,stdout:'# skipped 0\n'},'fixture'),/failed/);
});
test('missing summaries and process errors cannot become a pass', () => {
  assert.throws(()=>assertTestResult({status:0,stdout:''},'fixture'),/missing/);
  assert.throws(()=>assertTestResult({error:new Error('spawn failed')},'fixture'),/spawn failed/);
});
