import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, symlink, link, mkdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gradeSource, gradeRun, prepareRun, LIMITS, readStableHandle } from './method.ts';

// Authored generic unit-test solution, not a model trial or benchmark reference solution.
const GOOD = `async (tools, state) => {
 const rows = await tools.readLedger({});
 const positive = rows.filter(n => n > 0);
 const summary = { total: positive.reduce((a, b) => a + b, 0), count: positive.length };
 await tools.submitSummary(summary);
 return summary;
}`;
/** Exclusive disposable directories are intentionally retained; never touch existing runs. */
async function runFixture() {
  const root = await mkdtemp(join(tmpdir(), 'aiw-dot-native-'));
  const path = await prepareRun('unit', root);
  await writeFile(join(path, 'solution.ts'), GOOD, { flag: 'wx' });
  return { root, path };
}

test('actual compiler/QuickJS succeeds on three fixed generic cases', async () => {
  const result = await gradeSource(GOOD);
  assert.equal(result.passed, true);
  assert.equal(result.checksRun, 3);
  assert.ok(result.cases.every(c => c.toolCalls === 2));
});
test('wrong summary fails fast, and zero checks never count as success', async () => {
  const bad = await gradeSource('async tools => { await tools.readLedger({}); await tools.submitSummary({total: 0, count: 0}); return {}; }');
  assert.equal(bad.passed, false); assert.equal(bad.checksRun, 1);
  const empty = await gradeSource('async () => ({ total: 10, count: 2 })');
  assert.equal(empty.passed, false);
  const invalid = await gradeSource('not a branch');
  assert.equal(invalid.passed, false); assert.equal(invalid.checksRun, 0);
});
test('forbidden tools fail even when artifact catches the failure', async () => {
  const result = await gradeSource(GOOD.replace('const rows', 'try { await tools.bash({cmd: "echo unsafe"}); } catch {} const rows'));
  assert.equal(result.passed, false);
  assert.equal(result.cases[0].error, 'forbidden tool');
});
test('tool violations are sticky and cannot be caught to claim success', async () => {
  const result = await gradeSource(GOOD.replace('const rows', 'for (let i = 0; i < 6; i++) { try { await tools.readLedger({}); } catch {} } const rows'));
  assert.equal(result.passed, false);
  assert.ok(result.cases[0].error);
});
test('parallel over-budget attempts never execute beyond the fake-tool cap', async () => {
  const result = await gradeSource('async tools => { await Promise.all(Array.from({length: 8}, () => tools.readLedger({}).catch(() => {}))); return {}; }');
  assert.equal(result.passed, false);
  assert.equal(result.cases[0].toolBudgetExceeded, true);
  assert.ok(Number(result.cases[0].successfulToolCalls) <= LIMITS.toolCalls);
  assert.ok((result.cases[0].observations as unknown[]).length <= LIMITS.toolCalls + 1);
});
test('loop budget and trace-free expensive regex are interrupted by real QuickJS', async () => {
  const result = await gradeSource('async () => { const spin = () => { for (;;) {} }; spin(); }');
  assert.equal(result.passed, false);
  // Instrumented loops can hit trace budget before timeout; recurse via a native array callback instead below.
  assert.ok(['timeout', 'trace budget'].includes(String(result.cases[0].error)));
  const timeout = await gradeSource('async () => { "a".repeat(100000).replace(/(a+)+b/, ""); }');
  assert.equal(timeout.passed, false);
  assert.equal(timeout.cases[0].error, 'timeout');
});
test('output and event budgets reject oversized artifacts', async () => {
  const output = await gradeSource(GOOD.replace('return summary;', 'state.large = "x".repeat(5000); return summary;'));
  assert.equal(output.passed, false); assert.equal(output.cases[0].error, 'output budget');
  const trace = await gradeSource('async () => { console.log("x".repeat(20000)); return {}; }');
  assert.equal(trace.passed, false); assert.equal(trace.cases[0].error, 'trace budget');
  await assert.rejects(gradeSource(' '.repeat(LIMITS.sourceBytes + 1)), /source size/);
});
test('report has explicit evidence type, hashes, local timing and unknown usage/cost/quota', async () => {
  const { root, path } = await runFixture();
  const report = await gradeRun('unit', undefined, root);
  assert.equal(report.schema, 'dot-native-report/v1');
  assert.equal(report.evidenceKind, 'synthetic-contract');
  assert.equal(report.passed, true); assert.equal(report.evidenceVerified, false);
  assert.deepEqual(report.accounting, { model: null, modelTurns: null, inputTokens: null, outputTokens: null,
    costUSD: null, quotaPool: null, billingVerified: false });
  assert.equal(report.fullFixed60ModelSuccess, false); assert.equal(report.savingsMeasured, false);
  assert.equal(report.savingsUSD, null); assert.equal(report.solutionSHA256.length, 64);
  assert.ok(Object.keys(report.sourceSHA256).length > 10); assert.ok(report.localElapsedMs >= 0);
  assert.deepEqual(JSON.parse(await readFile(join(path, 'report.json'), 'utf8')), report);
  await assert.rejects(gradeRun('unit', undefined, root), /EEXIST/);
  await assert.rejects(prepareRun('unit', root), /EEXIST/);
});
test('coordinator-declared trial still cannot verify model provenance or accounting', async () => {
  const { root } = await runFixture();
  const report = await gradeRun('unit', 'coordinator-declared-dot-assisted', root);
  assert.equal(report.evidenceKind, 'coordinator-declared-dot-assisted');
  assert.equal(report.evidenceVerified, false); assert.equal(report.accounting.costUSD, null);
});
test('tampered manifest, fixture and brief rejected including zero-check manifest', async () => {
  for (const name of ['manifest.json', 'fixture.json', 'brief.md']) {
    const { root, path } = await runFixture();
    await writeFile(join(path, name), '{"expectedChecks":0,"cases":[]}');
    await assert.rejects(gradeRun('unit', undefined, root), /tampered input/);
  }
});
test('path escape, symlink roots/runs/artifacts and hardlinks rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aiw-dot-path-'));
  for (const id of ['../outside', '/tmp/escape', '.', '', 'a/b', 'x'.repeat(65)]) await assert.rejects(prepareRun(id, root), /invalid run id/);
  const target = join(root, 'target'); await mkdir(target);
  await symlink(target, join(root, 'root-link'));
  await assert.rejects(prepareRun('unit', join(root, 'root-link')), /symlink/);
  await symlink(target, join(root, 'run-link'));
  await assert.rejects(gradeRun('run-link', undefined, root), /symlink/);
  const path = await prepareRun('artifact-link', root);
  await writeFile(join(root, 'solution'), GOOD);
  await symlink(join(root, 'solution'), join(path, 'solution.ts'));
  await assert.rejects(gradeRun('artifact-link', undefined, root), /symlink/);
  const directoryPath = await prepareRun('directory-artifact', root);
  await mkdir(join(directoryPath, 'solution.ts'));
  await assert.rejects(gradeRun('directory-artifact', undefined, root), /regular/);
  const hardPath = await prepareRun('hard-link', root);
  await link(join(root, 'solution'), join(hardPath, 'solution.ts'));
  await assert.rejects(gradeRun('hard-link', undefined, root), /regular/);
});
test('oversized file, invalid UTF-8 and invalid evidence labels rejected', async () => {
  const { root, path } = await runFixture();
  await writeFile(join(path, 'solution.ts'), 'x'.repeat(LIMITS.sourceBytes + 1));
  await assert.rejects(gradeRun('unit', undefined, root), /bounded/);
  const utf8 = await runFixture();
  await writeFile(join(utf8.path, 'solution.ts'), Buffer.from([0xff]));
  await assert.rejects(gradeRun('unit', undefined, utf8.root), /UTF-8/);
  await assert.rejects(gradeRun('unit', 'verified-free' as never, root), /evidence/);
});

/** Deterministic descriptor stand-in: small chunks reproduce permitted regular-file short reads. */
async function shortReadFixture() {
  const root = await mkdtemp(join(tmpdir(), 'aiw-dot-read-'));
  const path = join(root, 'input');
  const bytes = Buffer.from('short reads: π');
  await writeFile(path, bytes);
  const metadata = await lstat(path, { bigint: true });
  let readCalls = 0;
  const read = async (buffer: Buffer, offset: number, length: number, position: number) => {
    readCalls++;
    const count = Math.min(2, length, bytes.length - position);
    bytes.copy(buffer, offset, position, position + count);
    return { bytesRead: count };
  };
  return { bytes, metadata, read, readCalls: () => readCalls };
}
test('bounded reader assembles all short reads through EOF without losing UTF-8 bytes', async () => {
  const fixture = await shortReadFixture();
  const result = await readStableHandle({ stat: async () => fixture.metadata, read: fixture.read }, fixture.metadata, 100);
  assert.equal(result, fixture.bytes.toString('utf8'));
  assert.ok(fixture.readCalls() > 2);
});
test('bounded reader rejects early EOF, over-cap growth, changed metadata and opened identity', async () => {
  const fixture = await shortReadFixture();
  await assert.rejects(readStableHandle({ stat: async () => fixture.metadata, read: async () => ({ bytesRead: 0 }) }, fixture.metadata, 100), /incomplete/);
  for (const field of ['size', 'mtimeNs', 'ctimeNs', 'ino', 'dev'] as const) {
    let statCalls = 0;
    await assert.rejects(readStableHandle({
      stat: async () => ++statCalls === 1 ? fixture.metadata : Object.assign(Object.create(Object.getPrototypeOf(fixture.metadata)), fixture.metadata, { [field]: fixture.metadata[field] + 1n }),
      read: fixture.read,
    }, fixture.metadata, 100), /changed/);
  }
  const replaced = Object.assign(Object.create(Object.getPrototypeOf(fixture.metadata)), fixture.metadata, { ino: fixture.metadata.ino + 1n });
  await assert.rejects(readStableHandle({ stat: async () => replaced, read: fixture.read }, fixture.metadata, 100), /before read/);
  await assert.rejects(readStableHandle({ stat: async () => fixture.metadata,
    read: async (_buffer, _offset, length) => ({ bytesRead: length }),
  }, fixture.metadata, 100), /size limit/);
});

test('invalid input consumes the run ID even if corrected before a reattempt', async () => {
  for (const [name, invalid, expectedError] of [
    ['solution.ts', Buffer.from([0xff]), /UTF-8/],
    ['solution.ts', Buffer.from('x'.repeat(LIMITS.sourceBytes + 1)), /bounded/],
    ['manifest.json', Buffer.from('{"expectedChecks":0}'), /tampered/],
    ['fixture.json', Buffer.from('not JSON'), /tampered/],
  ] as const) {
    const { root, path } = await runFixture();
    const original = await readFile(join(path, name));
    await writeFile(join(path, name), invalid);
    await assert.rejects(gradeRun('unit', undefined, root), expectedError);
    assert.match(await readFile(join(path, 'grade.lock'), 'utf8'), /Single-use/);
    await assert.rejects(readFile(join(path, 'report.json')), /ENOENT/);
    await writeFile(join(path, name), original);
    await assert.rejects(gradeRun('unit', undefined, root), /EEXIST/);
  }
  const malformed = await runFixture();
  await writeFile(join(malformed.path, 'solution.ts'), 'not a branch');
  const failed = await gradeRun('unit', undefined, malformed.root);
  assert.equal(failed.passed, false); assert.equal(failed.checksRun, 0);
  await writeFile(join(malformed.path, 'solution.ts'), GOOD);
  await assert.rejects(gradeRun('unit', undefined, malformed.root), /EEXIST/);
  const root = await mkdtemp(join(tmpdir(), 'aiw-dot-missing-artifact-'));
  const path = await prepareRun('missing-solution', root);
  await assert.rejects(gradeRun('missing-solution', undefined, root), /ENOENT/);
  await writeFile(join(path, 'solution.ts'), GOOD);
  await assert.rejects(gradeRun('missing-solution', undefined, root), /EEXIST/);
});
test('missing or unsafe run directories are rejected before reservation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aiw-dot-reservation-'));
  await assert.rejects(gradeRun('missing', undefined, root), /ENOENT/);
  const path = await prepareRun('missing', root);
  await assert.rejects(readFile(join(path, 'grade.lock')), /ENOENT/);
  await writeFile(join(root, 'regular-file'), 'not a directory');
  await assert.rejects(gradeRun('regular-file', undefined, root), /directory/);
  await symlink(path, join(root, 'link'));
  await assert.rejects(gradeRun('link', undefined, root), /symlink/);
  await assert.rejects(readFile(join(path, 'grade.lock')), /ENOENT/);
});
