/** Portable cloud test entry: the normal workspace tests, without tsx CLI's optional IPC server. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/** Find the same Python venv as the tool test fixtures; never download or install one. */
export function findVenv(root, env = process.env, exists = fs.existsSync) {
  return [env.AIW_VENV, path.join(root, 'packages/tools/.venv'), '/opt/aiw/venv']
    .filter(Boolean).map(p => path.resolve(root, p)).find(p => exists(path.join(p, 'bin/python')));
}

/** Cheap local entrypoint presence only, not native ABI/transitive closure readiness.
 * Canonicalize checkout aliases; never resolve modules from ancestor node_modules.
 * The existing relocated runtime readiness test remains required.
 */
export function assertLocalPackagedDependencies(root) {
  const canonicalRoot = fs.realpathSync(root);
  for (const entry of ['typescript-api/lib/typescript.js', 'isolated-vm/isolated-vm.js']) {
    const file = path.join(canonicalRoot, 'packages/server/dist/node_modules', entry);
    let local = false;
    try { local = fs.lstatSync(file).isFile() && fs.realpathSync(file) === file; } catch { /* absent/unreadable */ }
    if (!local) throw new Error(`Local packaged dependency entrypoint missing or nonlocal: ${file}. Materialize the already installed lockfile-resolved dist/node_modules closure using the documented offline preparation. No install/build was performed; no tests were run or counted as passed. Real relocated readiness remains required.`);
  }
}

/** Require complete positive TAP coverage, not merely a zero process exit or skipped count. */
export function assertTestResult(result, label, {files = [], cwd = process.cwd()} = {}) {
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status}, signal ${result.signal ?? 'none'})`);
  const counts = {};
  for (const field of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    // Only unindented final summaries count; nested suite output is not a second summary.
    const summaries = [...(result.stdout ?? '').matchAll(new RegExp(`^# ${field} (.*)$`, 'gm'))];
    if (summaries.length !== 1) throw new Error(`${label}: missing or ambiguous TAP ${field} summary`);
    const value = summaries[0][1];
    if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new Error(`${label}: invalid TAP ${field} count`);
    }
    counts[field] = Number(value);
  }
  if (counts.tests === 0 || counts.pass !== counts.tests ||
      ['fail', 'cancelled', 'skipped', 'todo'].some(field => counts[field] !== 0)) {
    throw new Error(`${label}: failed, cancelled, skipped, TODO or empty tests are not a full-suite pass`);
  }
  const names = [...(result.stdout ?? '').matchAll(/^# Subtest: (.*)$/gm)].map(match => match[1]);
  if (!names.length) throw new Error(`${label}: missing TAP test evidence`);
  const inputFiles = new Set(files.map(file => path.resolve(cwd, file)));
  // Node reports an empty test module as one passing test named after the file.
  if (names.some(name => inputFiles.has(path.resolve(cwd, name)))) {
    throw new Error(`${label}: file-only TAP result is not actual test coverage`);
  }
}

/** Python's unittest exit status alone permits skips; require explicit complete coverage too. */
export function assertDesignResult(result, label) {
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status}, signal ${result.signal ?? 'none'})`);
  let report;
  try { report = JSON.parse(result.stdout); }
  catch { throw new Error(`${label}: missing or invalid design/self-test JSON summary`); }
  const summary = report?.selfTests;
  const fields = ['run', 'failures', 'errors', 'skipped', 'expectedFailures', 'unexpectedSuccesses'];
  if (!summary || Object.keys(summary).sort().join() !== [...fields].sort().join() ||
      fields.some(field => !Number.isSafeInteger(summary[field]) || summary[field] < 0)) {
    throw new Error(`${label}: missing or invalid self-test counts`);
  }
  if (summary.run === 0 || fields.some(field => field !== 'run' && summary[field] !== 0)) {
    throw new Error(`${label}: failed, skipped, empty or incomplete self-tests are not a full-suite pass`);
  }
  if (report.designValid !== true || report.liveCalls !== 0 || report.campaignReady !== false || report.readyForLiveCalls !== false) {
    throw new Error(`${label}: invalid offline design result`);
  }
}

export function assertFixtureResult(result) {
 if(result.error)throw result.error;
 if(result.status!==0)throw new Error('native fixture controls failed');
 let report;try{report=JSON.parse(result.stdout);}catch{throw new Error('invalid fixture summary');}
 const fields=['run','failures','errors','skipped','expectedFailures','unexpectedSuccesses'];
 if(report?.kind!=='fixture-controls'||report.modelCalls!==0||!report.counts||Object.keys(report.counts).sort().join()!==fields.sort().join()||fields.some(k=>!Number.isSafeInteger(report.counts[k])||report.counts[k]<0)||report.counts.run===0||fields.some(k=>k!=='run'&&report.counts[k]!==0))throw new Error('incomplete native fixture coverage');
}

/** Validate optional test-file scheduling without silently accepting malformed configuration. */
export function testConcurrencyArgs(value) {
  if (value === undefined) return [];
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error('AIW_TEST_CONCURRENCY must be a positive safe integer (for serial local acceptance use 1); unset it to retain Node defaults. No tests were counted as passed.');
  }
  return [`--test-concurrency=${value}`];
}

/** Run all existing workspace tests plus mandatory shared development gates, then typecheck. */
export function main(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), {env: inputEnv = process.env, spawn = spawnSync} = {}) {
  // Validate before venv discovery, cache setup, or any child execution.
  const concurrencyArgs = testConcurrencyArgs(inputEnv.AIW_TEST_CONCURRENCY);
  assertLocalPackagedDependencies(root);
  const venv = findVenv(root, inputEnv);
  if (!venv) throw new Error('Python tool venv missing. Set AIW_VENV to a verified venv or prepare packages/tools/.venv using its documented dependencies. No tests were counted as passed.');
  // Inherited XDG_CACHE_HOME can exist but be read-only in cloud sandboxes.
  // An isolated per-run cache also avoids previous test state affecting results.
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'aiw-cloud-test-cache-'));
  fs.mkdirSync(cache, {recursive:true});
  const env = {...inputEnv, AIW_VENV:venv, XDG_CACHE_HOME:cache};
  console.log(`# Test-file concurrency: ${inputEnv.AIW_TEST_CONCURRENCY ?? 'Node default'}`);
  const runTests = (args, cwd, label) => {
    const result = spawn(process.execPath, ['--import','tsx','--test','--test-reporter=tap',...concurrencyArgs,...args], {cwd,env,encoding:'utf8',maxBuffer:32*1024*1024});
    process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
    assertTestResult(result, label, {files:args, cwd});
  };
  const entryTests = fs.readdirSync(path.join(root,'scripts')).filter(f => f.endsWith('.test.mjs')).sort().map(f => path.join('scripts',f));
  if (!entryTests.length) throw new Error('No expected top-level script tests found; no coverage claimed');
  runTests(entryTests,root,'cloud entry and migration checks');
  // These explicit gates are intentionally not covered by the top-level/package globs.
  // Missing scripts, empty coverage, or skips fail; none are optional readiness claims.
  for (const optimized of [false, true]) {
    const args = [...(optimized ? ['-O'] : []), 'scripts/evaluation/check_classifier_design.py', '--self-test'];
    const result = spawn(path.join(venv, 'bin/python'), args, {cwd:root,env,encoding:'utf8',maxBuffer:32*1024*1024});
    process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
    assertDesignResult(result, `offline design contract${optimized ? ' (optimized Python)' : ''}`);
  }
  runTests(['scripts/dot-native/method.test.ts'], root, 'dot-native local contract');
  const nativeTypes = spawn(process.execPath, [path.join(root,'node_modules/typescript/bin/tsc'),
    '--ignoreConfig', '--noEmit', '--module', 'nodenext', '--target', 'es2022', '--strict',
    '--allowImportingTsExtensions', '--skipLibCheck', '--types', 'node',
    'scripts/dot-native/method.ts', 'scripts/dot-native/cli.ts', 'scripts/dot-native/method.test.ts'], {cwd:root,env,stdio:'inherit'});
  if (nativeTypes.error) throw nativeTypes.error;
  if (nativeTypes.status !== 0) throw new Error(`dot-native typecheck failed (exit ${nativeTypes.status})`);
  runTests(['scripts/native-comparison/method.test.ts'], root, 'native-comparison local contract');
  const comparisonTypes = spawn(process.execPath, [path.join(root,'node_modules/typescript/bin/tsc'),
    '--ignoreConfig', '--noEmit', '--module', 'nodenext', '--target', 'es2022', '--strict',
    '--allowImportingTsExtensions', '--skipLibCheck', '--types', 'node',
    'scripts/native-comparison/method.ts', 'scripts/native-comparison/cli.ts', 'scripts/native-comparison/method.test.ts'], {cwd:root,env,stdio:'inherit'});
  if (comparisonTypes.error) throw comparisonTypes.error;
  if (comparisonTypes.status !== 0) throw new Error(`native-comparison typecheck failed (exit ${comparisonTypes.status})`);
  runTests(['protocol','files','controller','handoff','bootstrap','actor-data','public-admission','cooperative-screening','screening-audit','action-receipts','action-receipt-files','coordinator','check-runtime','cli','submit-open-input'].map(n=>`scripts/native-interactive/${n}.test.mjs`).concat(['scripts/native-interactive/session.test.ts','scripts/native-interactive/hotpath.test.ts']),root,'native-interactive local contract');
  const interactiveTypes=spawn(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),
    '--ignoreConfig','--noEmit','--module','nodenext','--target','es2022','--strict',
    '--allowImportingTsExtensions','--skipLibCheck','--types','node',
    'scripts/native-interactive/session.ts','scripts/native-interactive/worker.ts','scripts/native-interactive/session.test.ts','scripts/native-interactive/hotpath.ts','scripts/native-interactive/hotpath.test.ts'],{cwd:root,env,stdio:'inherit'});
  if(interactiveTypes.error)throw interactiveTypes.error;
  if(interactiveTypes.status!==0)throw new Error('native-interactive typecheck failed');
  const interactiveDeclarations=spawn(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),
    '--ignoreConfig','--noEmit','--module','nodenext','--target','es2022','--strict','--types','node',
    ...['readiness','controller','cli','check-runtime','handoff','bootstrap','handoff-files','action-receipts','action-receipt-files'].map(n=>`scripts/native-interactive/${n}.d.mts`)],{cwd:root,env,stdio:'inherit'});
  if(interactiveDeclarations.error)throw interactiveDeclarations.error;
  if(interactiveDeclarations.status!==0)throw new Error('native-interactive declaration typecheck failed');
  const fixtureControls=spawn(path.join(venv,'bin/python'),['scripts/native-fixture-controls.py'],{cwd:root,env,encoding:'utf8',maxBuffer:32*1024*1024});
  process.stdout.write(fixtureControls.stdout??'');process.stderr.write(fixtureControls.stderr??'');assertFixtureResult(fixtureControls);
  for (const name of fs.readdirSync(path.join(root,'packages')).sort()) {
    const cwd = path.join(root,'packages',name);
    const testDir = path.join(cwd,'test');
    if (!fs.existsSync(testDir)) { console.log(`# ${name}: no package test directory (no coverage claimed)`); continue; }
    const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.ts')).sort().map(f => path.join('test',f));
    if (!files.length) throw new Error(`${name}: test directory exists but no expected .test.ts files found`);
    runTests(files,cwd,name);
  }
  const check = spawn(process.execPath, [path.join(root,'node_modules/typescript/bin/tsc'),'-p','tsconfig.json'], {cwd:root,env,stdio:'inherit'});
  if (check.error) throw check.error;
  if (check.status !== 0) throw new Error(`typecheck failed (exit ${check.status})`);
  console.log('Cloud shared gates, package tests and typechecks passed. This is not a live-model benchmark.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode=1; }
}
