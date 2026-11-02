import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {findVenv,assertTestResult,testConcurrencyArgs,main} from './test-cloud.mjs';

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


test('test concurrency is explicit and strictly validated', () => {
  assert.deepEqual(testConcurrencyArgs(undefined), []);
  for (const value of ['1', '2', '16']) {
    assert.deepEqual(testConcurrencyArgs(value), [`--test-concurrency=${value}`]);
  }
  for (const value of ['', '0', '-1', '1.5', 'NaN', 'Infinity', '1e2', ' 1', '1 ', '01', '+1', '1\n', '9007199254740992', 1, null]) {
    assert.throws(() => testConcurrencyArgs(value), /AIW_TEST_CONCURRENCY must be a positive safe integer/);
  }
});

/** Make only discovery inputs; the fake spawn never runs package tests or typecheck. */
function fakeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiw-cloud-entry-fixture-'));
  for (const file of ['venv/bin/python', 'scripts/z.test.mjs', 'scripts/a.test.mjs',
    'packages/core/test/native-relocated.test.ts', 'packages/core/test/a.test.ts',
    'packages/tools/test/l-test.test.ts']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive:true});
    fs.writeFileSync(path.join(root, file), '');
  }
  return root;
}

/** Keep fake TAP summaries and fake success messages out of the enclosing real TAP stream. */
function runQuietly(t, root, options) {
  const stdout = t.mock.method(process.stdout, 'write', () => true);
  const stderr = t.mock.method(process.stderr, 'write', () => true);
  try { return main(root, options); }
  finally { stdout.mock.restore(); stderr.mock.restore(); }
}

for (const concurrency of [undefined, '1', '3']) {
  test(`main forwards exact scheduling and all test files, then typecheck (${concurrency ?? 'default'})`, (t) => {
    const root = fakeWorkspace();
    const calls = [];
    runQuietly(t, root, {env: {AIW_VENV:'venv', ...(concurrency === undefined ? {} : {AIW_TEST_CONCURRENCY:concurrency})}, spawn: (...args) => {
      calls.push(args);
      return {status:0, stdout:'# skipped 0\n', stderr:''};
    }});
    const flag = concurrency === undefined ? [] : [`--test-concurrency=${concurrency}`];
    const prefix = ['--import', 'tsx', '--test', '--test-reporter=tap', ...flag];
    assert.equal(calls.length, 4);
    assert.deepEqual(calls.map(([command]) => command), Array(4).fill(process.execPath));
    assert.deepEqual(calls.map(([, args]) => args), [
      [...prefix, 'scripts/a.test.mjs', 'scripts/z.test.mjs'],
      [...prefix, 'test/a.test.ts', 'test/native-relocated.test.ts'],
      [...prefix, 'test/l-test.test.ts'],
      [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'],
    ]);
    assert.deepEqual(calls.map(([, , options]) => options.cwd), [root, path.join(root, 'packages/core'), path.join(root, 'packages/tools'), root]);
    for (const [, , options] of calls) {
      assert.equal(options.env.AIW_VENV, path.join(root, 'venv'));
      assert.equal(options.env.NODE_OPTIONS, undefined);
    }
  });
}

test('main rejects invalid concurrency before discovery or child execution', () => {
  let calls = 0;
  assert.throws(() => main('/nonexistent-test-root', {env:{AIW_TEST_CONCURRENCY:'0'}, spawn:() => { calls++; }}), /AIW_TEST_CONCURRENCY/);
  assert.equal(calls, 0);
});

for (const [label, result, expected] of [
  ['nonzero', {status:1, stdout:'# skipped 0\n'}, /failed/],
  ['skip', {status:0, stdout:'# skipped 1\n'}, /skipped tests/],
  ['missing summary', {status:0, stdout:''}, /missing/],
  ['ambiguous summary', {status:0, stdout:'# skipped 0\n# skipped 0\n'}, /ambiguous/],
  ['signal', {status:null, signal:'SIGTERM', stdout:''}, /failed/],
  ['spawn error', {error:new Error('cannot spawn')}, /cannot spawn/],
]) {
  test(`serial main remains fail-fast on ${label}`, (t) => {
    const root = fakeWorkspace();
    let calls = 0;
    assert.throws(() => runQuietly(t, root, {env:{AIW_VENV:'venv', AIW_TEST_CONCURRENCY:'1'}, spawn:() => {
      calls++;
      return result;
    }}), expected);
    assert.equal(calls, 1, 'later packages and typecheck must not run after failure');
  });
}

test('serial main still rejects typecheck failure after all test children', (t) => {
  const root = fakeWorkspace();
  let calls = 0;
  assert.throws(() => runQuietly(t, root, {env:{AIW_VENV:'venv', AIW_TEST_CONCURRENCY:'1'}, spawn:() => {
    calls++;
    return {status:calls === 4 ? 2 : 0, stdout:'# skipped 0\n'};
  }}), /typecheck failed/);
  assert.equal(calls, 4);
});
