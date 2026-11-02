import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {findVenv,assertTestResult,assertDesignResult,testConcurrencyArgs,main} from './test-cloud.mjs';

/** Realistic final TAP summaries, with a named test rather than Node's empty-file fallback. */
function tap(overrides = {}) {
  const counts = {tests:1,suites:0,pass:1,fail:0,cancelled:0,skipped:0,todo:0,...overrides};
  return '# Subtest: synthetic assertion\nok 1 - synthetic assertion\n1..1\n' +
    Object.entries(counts).map(([field,value]) => `# ${field} ${value}\n`).join('');
}

test('venv discovery prefers explicit environment and resolves relative paths', () => {
  assert.equal(findVenv('/repo',{AIW_VENV:'env'}, p => ['/repo/env/bin/python','/repo/packages/tools/.venv/bin/python'].includes(p)), '/repo/env');
});
test('venv discovery uses repository venv without a machine-specific path', () => {
  assert.equal(findVenv('/repo',{},p => p === '/repo/packages/tools/.venv/bin/python'), '/repo/packages/tools/.venv');
  assert.equal(findVenv('/repo',{},()=>false),undefined);
});
test('test result requires zero skips and successful exit', () => {
  assert.doesNotThrow(()=>assertTestResult({status:0,stdout:tap()},'fixture'));
  assert.throws(()=>assertTestResult({status:0,stdout:tap({skipped:2})},'fixture'),/skipped/);
  assert.throws(()=>assertTestResult({status:1,stdout:tap()},'fixture'),/failed/);
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

const designReport = {
  designValid: true, liveCalls: 0, campaignReady: false, readyForLiveCalls: false,
  selfTests: {run:12, failures:0, errors:0, skipped:0, expectedFailures:0, unexpectedSuccesses:0},
};

/** Match real Python JSON and Node TAP separately without executing either child. */
function successfulChild(args) {
  return {status:0, stdout:args.includes('scripts/evaluation/check_classifier_design.py')
    ? JSON.stringify(designReport) : tap(), stderr:''};
}

/** Exact focused native typecheck remains separate from the package-only tsconfig. */
function nativeTypeArgs(root) {
  return [path.join(root, 'node_modules/typescript/bin/tsc'),
    '--ignoreConfig', '--noEmit', '--module', 'nodenext', '--target', 'es2022', '--strict',
    '--allowImportingTsExtensions', '--skipLibCheck', '--types', 'node',
    'scripts/dot-native/method.ts', 'scripts/dot-native/cli.ts', 'scripts/dot-native/method.test.ts'];
}

test('design gate requires successful process, real complete counts, and offline-only success', () => {
  const valid = {status:0, stdout:JSON.stringify(designReport)};
  assert.doesNotThrow(() => assertDesignResult(valid, 'design'));
  for (const result of [{status:1}, {status:null,signal:'SIGTERM'}, {error:new Error('spawn failed')},
    {status:0,stdout:''}, {status:0,stdout:'{}'}, {status:0,stdout:'null'},
    {status:0,stdout:valid.stdout + valid.stdout}]) {
    assert.throws(() => assertDesignResult(result, 'design'));
  }
  for (const [field, values] of Object.entries({run:[0,-1,1.5,'12',null], failures:[1], errors:[1],
    skipped:[1], expectedFailures:[1], unexpectedSuccesses:[1]})) {
    for (const value of values) {
      const report = structuredClone(designReport);
      report.selfTests[field] = value;
      assert.throws(() => assertDesignResult({status:0,stdout:JSON.stringify(report)}, 'design'));
    }
  }
  for (const mutation of [r => delete r.selfTests.skipped, r => r.selfTests.extra = 0,
    r => r.designValid = false, r => r.liveCalls = 1, r => r.campaignReady = true,
    r => r.readyForLiveCalls = true]) {
    const report = structuredClone(designReport); mutation(report);
    assert.throws(() => assertDesignResult({status:0,stdout:JSON.stringify(report)}, 'design'));
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
      return successfulChild(args[1]);
    }});
    const flag = concurrency === undefined ? [] : [`--test-concurrency=${concurrency}`];
    const prefix = ['--import', 'tsx', '--test', '--test-reporter=tap', ...flag];
    assert.equal(calls.length, 10);
    assert.deepEqual(calls.map(([command]) => command), [process.execPath, path.join(root,'venv/bin/python'), path.join(root,'venv/bin/python'), ...Array(7).fill(process.execPath)]);
    assert.deepEqual(calls.map(([, args]) => args), [
      [...prefix, 'scripts/a.test.mjs', 'scripts/z.test.mjs'],
      ['scripts/evaluation/check_classifier_design.py', '--self-test'],
      ['-O', 'scripts/evaluation/check_classifier_design.py', '--self-test'],
      [...prefix, 'scripts/dot-native/method.test.ts'],
      nativeTypeArgs(root),
      [...prefix, 'scripts/native-comparison/method.test.ts'],
      nativeTypeArgs(root).map(arg => arg.replace('scripts/dot-native/', 'scripts/native-comparison/')),
      [...prefix, 'test/a.test.ts', 'test/native-relocated.test.ts'],
      [...prefix, 'test/l-test.test.ts'],
      [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'],
    ]);
    assert.deepEqual(calls.map(([, , options]) => options.cwd), [root, root, root, root, root, root, root, path.join(root, 'packages/core'), path.join(root, 'packages/tools'), root]);
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
  ['nonzero', {status:1, stdout:tap()}, /failed/],
  ['skip', {status:0, stdout:tap({skipped:1})}, /skipped/],
  ['missing summary', {status:0, stdout:''}, /missing/],
  ['ambiguous summary', {status:0, stdout:tap()+'# skipped 0\n'}, /ambiguous/],
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
  assert.throws(() => runQuietly(t, root, {env:{AIW_VENV:'venv', AIW_TEST_CONCURRENCY:'1'}, spawn:(_command, args) => {
    calls++;
    return calls === 10 ? {status:2} : successfulChild(args);
  }}), /typecheck failed/);
  assert.equal(calls, 10);
});

for (const [failedCall, label, result, expected] of [
  [2, 'normal Python failure', {status:1}, /offline design contract failed/],
  [2, 'normal Python skips', {status:0,stdout:JSON.stringify({...designReport,selfTests:{...designReport.selfTests,skipped:1}})}, /skipped/],
  [3, 'optimized Python malformed summary', {status:0,stdout:'{}'}, /self-test counts/],
  [3, 'optimized Python spawn error', {error:new Error('python unavailable')}, /python unavailable/],
  [4, 'native contract skips', {status:0,stdout:tap({skipped:1})}, /skipped/],
  [4, 'native contract failure', {status:1,stdout:''}, /dot-native local contract failed/],
  [5, 'native typecheck failure', {status:1}, /dot-native typecheck failed/],
  [5, 'native typecheck spawn error', {error:new Error('typescript unavailable')}, /typescript unavailable/],
  [6, 'comparison contract skips', {status:0,stdout:tap({skipped:1})}, /skipped/],
  [6, 'comparison contract empty coverage', {status:0,stdout:tap({tests:0,pass:0})}, /empty/],
  [6, 'comparison contract failure', {status:1,stdout:''}, /native-comparison local contract failed/],
  [7, 'comparison typecheck failure', {status:1}, /native-comparison typecheck failed/],
  [7, 'comparison typecheck spawn error', {error:new Error('comparison types unavailable')}, /comparison types unavailable/],
]) {
  test(`shared gates stop later tests and checks on ${label}`, t => {
    const root = fakeWorkspace();
    let calls = 0;
    assert.throws(() => runQuietly(t, root, {env:{AIW_VENV:'venv',AIW_TEST_CONCURRENCY:'1'}, spawn:(_command,args) => {
      calls++;
      return calls === failedCall ? result : successfulChild(args);
    }}), expected);
    assert.equal(calls, failedCall);
  });
}

test('TAP summaries reject zero/TODO/cancelled/failing or malformed coverage but allow nested suites', () => {
  for (const counts of [{tests:0,pass:0}, {todo:1,pass:0}, {cancelled:1,pass:0},
    {fail:1,pass:0}, {tests:2,pass:1}, {tests:-1}, {tests:1.5}, {tests:'01'},
    {tests:'9007199254740992'}, {skipped:'unknown'}]) {
    assert.throws(() => assertTestResult({status:0,stdout:tap(counts)}, 'fixture'));
  }
  for (const field of ['tests','suites','pass','fail','cancelled','skipped','todo']) {
    const output = tap();
    assert.throws(() => assertTestResult({status:0,stdout:output.replace(new RegExp(`^# ${field} .*\\n`, 'm'), '')}, 'fixture'), /missing/);
    assert.throws(() => assertTestResult({status:0,stdout:output+`# ${field} 0\n`}, 'fixture'), /ambiguous/);
  }
  assert.throws(() => assertTestResult({status:0,stdout:tap().replace('# Subtest: synthetic assertion\n','')}, 'fixture'), /test evidence/);
  assert.doesNotThrow(() => assertTestResult({status:0,stdout:
    '# Subtest: suite\n    # Subtest: assertion\n    ok 1 - assertion\n    # tests 1\n    # skipped 0\n' + tap({suites:1})}, 'nested'));
});

test('real empty Node test module cannot count as native coverage', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiw-empty-node-regression-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const file = path.join(root, 'empty.test.mjs');
  fs.writeFileSync(file, '');
  const env = {...process.env};
  delete env.NODE_TEST_CONTEXT; // The child is an independent test runner, not its parent's worker.
  const result = spawnSync(process.execPath, ['--test','--test-reporter=tap',file], {cwd:root,env,encoding:'utf8'});
  assert.equal(result.status, 0);
  assert.throws(() => assertTestResult(result, 'empty native fixture', {files:[file],cwd:root}), /file-only/);
  assert.throws(() => assertTestResult(result, 'relative empty native fixture', {files:['empty.test.mjs'],cwd:root}), /file-only/);
});

test('empty entry discovery fails before a test child can fall back to implicit discovery', t => {
  const root = fakeWorkspace();
  for (const name of ['a.test.mjs','z.test.mjs']) fs.unlinkSync(path.join(root,'scripts',name));
  let calls = 0;
  assert.throws(() => runQuietly(t,root,{env:{AIW_VENV:'venv'},spawn:() => {calls++;}}), /No expected top-level script tests/);
  assert.equal(calls,0);
});
