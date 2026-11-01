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

/** A successful Node test process must not hide missing coverage behind skips. */
export function assertTestResult(result, label) {
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status}, signal ${result.signal ?? 'none'})`);
  const summaries = [...result.stdout.matchAll(/^# skipped (\d+)$/gm)];
  if (summaries.length !== 1) throw new Error(`${label}: missing or ambiguous TAP skip summary`);
  if (Number(summaries[0][1]) !== 0) throw new Error(`${label}: skipped tests are not a full-suite pass`);
}

/** Run unchanged workspace test files in their own workspace, then the project's typecheck. */
export function main(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  const venv = findVenv(root);
  if (!venv) throw new Error('Python tool venv missing. Set AIW_VENV to a verified venv or prepare packages/tools/.venv using its documented dependencies. No tests were counted as passed.');
  // Inherited XDG_CACHE_HOME can exist but be read-only in cloud sandboxes.
  // An isolated per-run cache also avoids previous test state affecting results.
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'aiw-cloud-test-cache-'));
  fs.mkdirSync(cache, {recursive:true});
  const env = {...process.env, AIW_VENV:venv, XDG_CACHE_HOME:cache};
  const runTests = (args, cwd, label) => {
    const result = spawnSync(process.execPath, ['--import','tsx','--test','--test-reporter=tap',...args], {cwd,env,encoding:'utf8',maxBuffer:32*1024*1024});
    process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
    assertTestResult(result, label);
  };
  runTests(['scripts/test-cloud.test.mjs'],root,'cloud entry checks');
  for (const name of fs.readdirSync(path.join(root,'packages')).sort()) {
    const cwd = path.join(root,'packages',name);
    const testDir = path.join(cwd,'test');
    if (!fs.existsSync(testDir)) { console.log(`# ${name}: no package test directory (no coverage claimed)`); continue; }
    const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.ts')).sort().map(f => path.join('test',f));
    if (!files.length) throw new Error(`${name}: test directory exists but no expected .test.ts files found`);
    runTests(files,cwd,name);
  }
  const check = spawnSync(process.execPath, [path.join(root,'node_modules/typescript/bin/tsc'),'-p','tsconfig.json'], {cwd:root,env,stdio:'inherit'});
  if (check.error) throw check.error;
  if (check.status !== 0) throw new Error(`typecheck failed (exit ${check.status})`);
  console.log('Cloud package tests and typecheck passed. This is not a live-model benchmark.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode=1; }
}
