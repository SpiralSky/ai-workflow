import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, symlink, link, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { admitSource, loadCatalog, REVIEWED_CATALOG_ROOT } from './catalog.ts';
import { syntheticHarness, gradeSource, prepareEngine, ENGINE_SETUP_TIMEOUT_MS, LIMITS } from './method.ts';
import { commonPrefixBytes, payloadProxy } from './proxy.ts';
import { TASKS } from './tasks.ts';
import { SYNTHETIC_SOLUTIONS } from './synthetic-solutions.test-data.ts';
import { SYNTHETIC_CATALOG } from './synthetic-catalog.test-data.ts';

/** Disposable synthetic fixtures are retained; no worker, model, repository tool or real task runs. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'aiw-native-comparison-'));
  const harness = syntheticHarness(SYNTHETIC_CATALOG, root);
  const prepared = await harness.prepare('unit');
  return { root, harness, ...prepared };
}
/** Seed one fake assignment from the test-only reference, never native evidence. */
async function solution(path: string, cell: string, source?: string) {
  const task = TASKS.find(t => cell.startsWith(`${t.id}-`))!;
  await writeFile(join(path, cell, 'solution.ts'), source ?? SYNTHETIC_SOLUTIONS[task.id], { flag: 'wx' });
}

for (const task of TASKS) test(`real compiler/QuickJS passes all frozen ${task.id} cases`, async () => {
  const result = await gradeSource(task, SYNTHETIC_SOLUTIONS[task.id]);
  assert.equal(result.passed, true, JSON.stringify(result)); assert.equal(result.checksRun, task.cases.length); assert.equal(result.checksExpected, task.cases.length);
  assert.deepEqual(result.cases.map(c => c.id), task.cases.map(c => c.id));
  assert.deepEqual(result.cases.map(c => c.acceptedToolCalls), task.cases.map(c => c.calls.length));
  assert.equal(result.infrastructurePreflight.operation, 'empty-isolate-create-dispose');
  assert.equal(result.infrastructurePreflight.timeoutMs, ENGINE_SETUP_TIMEOUT_MS);
});

test('empty engine preparation can exceed the artifact deadline under its separate infrastructure bound', async () => {
  let created = 0, disposed = 0;
  const setup = await prepareEngine({ async create(opts) {
    created++; assert.deepEqual(opts, { memoryMb: LIMITS.memoryMb });
    await new Promise(resolve => setTimeout(resolve, LIMITS.timeoutMs + 25));
    return { dispose() { disposed++; } };
  } });
  assert.equal(created, 1); assert.equal(disposed, 1);
  assert.ok(setup.localElapsedMs >= LIMITS.timeoutMs); assert.equal(setup.timeoutMs, 10_000);
  assert.equal(LIMITS.timeoutMs, 1000, 'artifact deadline is not raised by infrastructure setup');
});

test('engine setup failures are infrastructure errors and late construction is still disposed', async () => {
  await assert.rejects(prepareEngine({ async create() { throw new Error('constructor failure'); } }), /infrastructure preflight/);
  let disposed = 0, release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await assert.rejects(prepareEngine({ async create() {
    await delayed; return { dispose() { disposed++; } };
  } }, 5), /infrastructure preflight.*setup timeout/);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, 1);
});

test('invalid source, fabricated return and empty cases never count as success', async () => {
  const invalid = await gradeSource(TASKS[0], 'not a branch');
  assert.equal(invalid.passed, false); assert.equal(invalid.checksRun, 0); assert.equal(invalid.checksExpected, TASKS[0].cases.length);
  const missingCalls = await gradeSource(TASKS[0], `async () => (${JSON.stringify(TASKS[0].cases[0].expected)})`);
  assert.equal(missingCalls.passed, false); assert.equal(missingCalls.checksRun, 1);
  await assert.rejects(gradeSource({ ...TASKS[0], cases: [] }, 'async () => true'), /positive unique/);
  for (const text of ['', ' '.repeat(10), 'x'.repeat(LIMITS.sourceBytes + 1)]) await assert.rejects(gradeSource(TASKS[0], text), /size/);
});

test('caught forbidden tool and wrong-argument attempts remain sticky failures', async () => {
  for (const attempt of ['await tools.bash({cmd:"echo forbidden"})', 'await tools.check({path:"wrong.py"})']) {
    const source = SYNTHETIC_SOLUTIONS[TASKS[0].id].replace('const safe', `try { ${attempt}; } catch {} const safe`);
    const result = await gradeSource(TASKS[0], source);
    assert.equal(result.passed, false); assert.equal(result.checksRun, 1);
    assert.match(String(result.cases[0].error), /forbidden tool|unexpected tool/);
  }
});

test('parallel attempts cannot execute past the fake-host cap', async () => {
  const result = await gradeSource(TASKS[0], 'async (tools,state) => { await Promise.all(Array.from({length:8},()=>tools.check({path:state.path}).catch(()=>{}))); return {}; }');
  assert.equal(result.passed, false);
  assert.ok(Number(result.cases[0].acceptedToolCalls) <= LIMITS.toolCalls);
  assert.ok((result.cases[0].observations as unknown[]).length <= LIMITS.toolCalls + 1);
});

test('real QuickJS enforces trace, timeout, and output/state bounds', async () => {
  const loop = await gradeSource(TASKS[0], 'async () => { for (;;) {} }');
  assert.equal(loop.passed, false); assert.match(String(loop.cases[0].error), /trace budget|timeout/);
  const timeout = await gradeSource(TASKS[0], 'async () => { "a".repeat(100000).replace(/(a+)+b/, ""); }');
  assert.equal(timeout.passed, false); assert.equal(timeout.cases[0].error, 'timeout');
  const output = await gradeSource(TASKS[0], SYNTHETIC_SOLUTIONS[TASKS[0].id].replace('const safe', 'state.large="x".repeat(5000); const safe'));
  assert.equal(output.passed, false); assert.equal(output.cases[0].error, 'output budget');
});

test('expected host errors require exact propagation plus every actual preceding call', async () => {
  for (const original of TASKS) {
    for (const fixture of original.cases.filter(c => c.expectedError !== undefined)) {
      const task = { ...original, cases: [fixture] };
      const good = await gradeSource(task, SYNTHETIC_SOLUTIONS[task.id]);
      assert.equal(good.passed, true);
      assert.deepEqual(good.cases[0].runtimeError, { code: 'thrown', message: fixture.expectedError });
      const fabricated = await gradeSource(task, `async () => { throw new Error(${JSON.stringify(fixture.expectedError)}); }`);
      assert.equal(fabricated.passed, false); assert.equal(fabricated.cases[0].acceptedToolCalls, 0);
      const swallowed = await gradeSource(task, `async (tools,state) => { try { return await (${SYNTHETIC_SOLUTIONS[task.id]})(tools,state); } catch { return {}; } }`);
      assert.equal(swallowed.passed, false);
      const changed = await gradeSource(task, `async (tools,state) => { try { return await (${SYNTHETIC_SOLUTIONS[task.id]})(tools,state); } catch { throw new Error('different error'); } }`);
      assert.equal(changed.passed, false);
    }
  }
});

test('normal return mismatches, invented error outcomes, and weakened contract mutations fail', async () => {
  const badFixture = { ...TASKS[0], cases: [{ ...TASKS[0].cases[0], expectedError: 'fake' }] };
  await assert.rejects(gradeSource(badFixture, SYNTHETIC_SOLUTIONS[TASKS[0].id]), /exactly one/);
  for (const expectedError of [undefined, 'x'.repeat(301)]) {
    const fixture = { id: 'invalid-error-expectation', state: {}, calls: [{ name: 'check', args: {}, error: expectedError }], expectedError };
    await assert.rejects(gradeSource({ ...TASKS[0], cases: [fixture] }, SYNTHETIC_SOLUTIONS[TASKS[0].id]), /exactly one/);
  }
  const mutations = [
    [0, 'line-2', 'line-3'], [0, 'errorCount===0&&truncated===null', 'errorCount===0'],
    [0, 'Number.isInteger(d.line)', 'typeof d.line === "number"'],
    [0, "message:d.message.slice(0,120)", 'message:d.message'],
    [1, "if(f.truncated)", 'if(false)'], [1, "path.split('/').pop()!==name", 'false'],
    [1, 'x.includes(state.term)', 'new RegExp(state.term).test(x)'], [1, 'matches.length-3', '0'],
    [1, 'if(!/\\bENOENT\\b/.test(String(e)))', 'if(false)'],
    [1, 'const safe', 'state.changed = true; const safe'],
  ] as const;
  for (const [index, from, to] of mutations) {
    const source = SYNTHETIC_SOLUTIONS[TASKS[index].id]; assert.ok(source.includes(from), from);
    const result = await gradeSource(TASKS[index], source.replace(from, to));
    assert.equal(result.passed, false, `mutation must fail: ${from}`);
  }
});

test('artifact imports and access to native process/filesystem are not executable host code', async () => {
  const imported = await gradeSource(TASKS[0], 'async () => { await import("node:fs"); }');
  assert.equal(imported.passed, false); assert.equal(imported.checksRun, 0);
  const native = await gradeSource(TASKS[0], 'async () => process.cwd()');
  assert.equal(native.passed, false); assert.equal(native.cases[0].error, 'thrown');
});

test('catalog module roots cannot be chosen from artifacts or arbitrary clones', async () => {
  await assert.rejects(loadCatalog('.'), /absolute/);
  await assert.rejects(loadCatalog('/tmp'), /approved known/);
  await assert.rejects(loadCatalog(REVIEWED_CATALOG_ROOT + '/.'), /absolute/);
});

/** Synthetic Git data only; none of these source strings is imported or executed. */
async function sourceFixture(initialMessage = 'synthetic fixture') {
  const root = await mkdtemp(join(tmpdir(), 'aiw-catalog-source-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-b', 'fixture');
  for (const path of ['package.json', 'package-lock.json', 'packages/core/package.json', 'packages/llm/package.json',
    'packages/telemetry/package.json', 'packages/server/package.json', 'packages/core/src/index.ts',
    'packages/llm/src/index.ts', 'packages/telemetry/src/index.ts', 'packages/server/dist/aiw-server.mjs']) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), 'synthetic never-executed source\n');
  }
  const commit = (message = 'synthetic fixture') => {
    git('add', '.');
    git('-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const pin = commit(initialMessage);
  return { root, git, commit, pin, tree: git('rev-parse', 'HEAD^{tree}') };
}

test('source-equivalent clean doc-only descendant retains reviewed tree and observed commit', async () => {
  const f = await sourceFixture(); const before = await admitSource(f.root, f.tree);
  await writeFile(join(f.root, 'review-notes.md'), 'synthetic documentation only\n'); const descendant = f.commit();
  const after = await admitSource(f.root, f.tree);
  assert.equal(after.reviewedSourceTree, f.tree); assert.equal(after.observedCheckoutCommit, descendant);
  assert.notEqual(descendant, f.pin); assert.deepEqual(after.sourceSHA256, before.sourceSHA256);
});

test('fresh clone of metadata-distinct publication accepts the same reviewed tree without local commit objects', async () => {
  const local = await sourceFixture('unpublished local metadata');
  const published = await sourceFixture('canonical publication metadata');
  assert.equal(published.tree, local.tree); assert.notEqual(published.pin, local.pin);
  const clone = await mkdtemp(join(tmpdir(), 'aiw-catalog-publication-clone-'));
  execFileSync('git', ['clone', '--no-local', published.root, clone], { stdio: 'pipe' });
  assert.throws(() => execFileSync('git', ['-C', clone, 'cat-file', '-e', local.pin], { stdio: 'pipe' }));
  const admitted = await admitSource(clone, local.tree);
  assert.equal(admitted.reviewedSourceTree, local.tree);
  assert.equal(admitted.observedCheckoutCommit, published.pin);
  assert.deepEqual(admitted.sourceSHA256, (await admitSource(local.root, local.tree)).sourceSHA256);
});

test('source/lock/bundle/manifest changes and clean nondescendants fail before any module load', async () => {
  for (const path of ['packages/core/src/index.ts', 'package-lock.json', 'packages/server/dist/aiw-server.mjs', 'packages/llm/package.json']) {
    const f = await sourceFixture(); await writeFile(join(f.root, path), 'changed bytes\n'); f.commit();
    await assert.rejects(admitSource(f.root, f.tree), /Git tree differs/);
  }
  const f = await sourceFixture(); f.git('checkout', '--orphan', 'unrelated');
  await writeFile(join(f.root, 'unrelated-history.md'), 'distinct synthetic root commit\n');
  assert.notEqual(f.commit(), f.pin);
  await assert.rejects(admitSource(f.root, f.tree), /history/);
});

test('working source bytes cannot hide behind Git assume-unchanged metadata', async () => {
  const f = await sourceFixture(); const path = 'packages/core/src/index.ts';
  f.git('update-index', '--assume-unchanged', path); await writeFile(join(f.root, path), 'hidden working mutation\n');
  assert.equal(f.git('status', '--porcelain'), '');
  await assert.rejects(admitSource(f.root, f.tree), /working bytes differ/);
});

test('preparation is exclusive and ungraded cells retain the full denominator', async () => {
  const f = await fixture(); assert.equal(f.assignmentsLaunched, 0);
  assert.equal(JSON.parse(await readFile(join(f.path, 'manifest.json'), 'utf8')).catalog.kind, 'synthetic-contract-fixture');
  assert.throws(() => syntheticHarness({ ...SYNTHETIC_CATALOG, kind: 'reviewed-local' }, f.root), /synthetic fixture/);
  await assert.rejects(f.harness.prepare('unit'), /EEXIST/);
  const report = await f.harness.summarize('unit');
  assert.equal(report.results.length, 4); assert.ok(report.results.every(c => c.status === 'not-graded'));
  assert.equal(report.complete, false); assert.equal(report.relativePayloadRankingEligible, false);
  assert.equal(report.sensitivity, null);
  assert.ok(report.arms.every(a => a.plannedTasks === 2 && a.checksExpected === TASKS.reduce((n, t) => n + t.cases.length, 0) && a.checksRun === 0 && !a.fullRequiredArtifactSuccess));
});

test('four synthetic artifacts retain null accounting and produce only visible-payload sensitivity', async () => {
  const f = await fixture();
  for (const cell of f.cells) {
    await solution(f.path, cell);
    const report = await f.harness.grade('unit', cell);
    assert.equal(report.passed, true); assert.equal(report.evidenceVerified, false);
    assert.ok(Object.values(report.accounting).every(v => v === null));
    await assert.rejects(f.harness.grade('unit', cell), /EEXIST/);
  }
  const summary = await f.harness.summarize('unit');
  assert.equal(summary.complete, true); assert.equal(summary.relativePayloadRankingEligible, true);
  assert.equal(summary.sensitivity?.length, 9);
  assert.ok(summary.arms.every(a => a.checksRun === TASKS.reduce((n, t) => n + t.cases.length, 0) && a.checksPassed === a.checksRun && a.taskSuccessFraction === '2/2'));
  assert.ok(summary.sensitivity!.every(s => s.lowerVisiblePayloadArm === 'off'));
});

test('task and compile failures retain reports, incomplete checks and all four planned cells', async () => {
  const f = await fixture();
  await solution(f.path, f.cells[0], 'not a branch');
  await solution(f.path, f.cells[1], 'async () => ({})');
  for (const cell of f.cells.slice(0, 2)) assert.equal((await f.harness.grade('unit', cell)).passed, false);
  const summary = await f.harness.summarize('unit');
  assert.deepEqual(summary.results.map(r => r.status), ['task-failure', 'task-failure', 'not-graded', 'not-graded']);
  assert.deepEqual(summary.arms.map(a => a.checksRun), [0, 1]);
  assert.equal(summary.relativePayloadRankingEligible, false);
});

test('invalid and missing artifacts consume a reservation before any repair is possible', async () => {
  for (const invalid of [Buffer.from([0xff]), Buffer.from('x'.repeat(LIMITS.sourceBytes + 1)), null]) {
    const f = await fixture(); const cell = f.cells[0];
    if (invalid) await writeFile(join(f.path, cell, 'solution.ts'), invalid);
    await assert.rejects(f.harness.grade('unit', cell), /UTF-8|regular|ENOENT/);
    assert.match(await readFile(join(f.path, cell, 'grade.lock'), 'utf8'), /Single-use/);
    const summary = await f.harness.summarize('unit');
    assert.equal(summary.results[0].status, 'reserved-without-report');
    await writeFile(join(f.path, cell, 'solution.ts'), SYNTHETIC_SOLUTIONS[TASKS[0].id]);
    await assert.rejects(f.harness.grade('unit', cell), /EEXIST/);
  }
});

test('manifest and brief tampering reserve failures and fail closed even when repaired', async () => {
  for (const file of ['manifest.json', 'diagnostic-record-off/brief.md']) {
    const f = await fixture(); const path = join(f.path, file); const original = await readFile(path);
    await writeFile(path, '{"checksExpected":0}');
    await assert.rejects(f.harness.grade('unit', f.cells[0]), /changed/);
    await writeFile(path, original);
    await assert.rejects(f.harness.grade('unit', f.cells[0]), /EEXIST/);
  }
});

test('path escapes, symlink inputs, hardlinks and special files cannot be admitted', async () => {
  const f = await fixture();
  for (const id of ['../escape', '/tmp/escape', '', '.', 'x'.repeat(65)]) await assert.rejects(f.harness.grade(id, f.cells[0]), /run id/);
  await assert.rejects(f.harness.grade('unit', '../escape'), /cell id/);
  const outside = join(f.root, 'input'); await writeFile(outside, SYNTHETIC_SOLUTIONS[TASKS[0].id]);
  await symlink(outside, join(f.path, f.cells[0], 'solution.ts'));
  await link(outside, join(f.path, f.cells[1], 'solution.ts'));
  await mkdir(join(f.path, f.cells[2], 'solution.ts'));
  for (const cell of f.cells.slice(0, 3)) await assert.rejects(f.harness.grade('unit', cell), /symlink|regular/);
  await symlink(f.path, join(f.root, 'linked'));
  await assert.rejects(f.harness.grade('linked', f.cells[3]), /symlink/);
  await assert.rejects(readFile(join(f.path, f.cells[3], 'grade.lock')), /ENOENT/);
});

test('summaries reject forged success, zero checks, altered observations, identities and accounting', async () => {
  const f = await fixture(); const cell = f.cells[0]; await solution(f.path, cell);
  await f.harness.grade('unit', cell);
  const path = join(f.path, cell, 'report.json'); const original = await readFile(path, 'utf8');
  const baseline = JSON.parse(original);
  assert.equal(baseline.passed, true, `Reference grade must pass before tamper checks: ${original}`);
  assert.equal(baseline.checksRun, baseline.checksExpected);
  const mutations: Array<(r: any) => void> = [
    r => { r.checksRun = 0; r.cases = []; }, r => { r.checksExpected = 0; },
    r => { r.passed = !r.passed; }, r => { r.cases[0].passed = false; },
    r => { r.cases[0].toolCalls = 0; }, r => { r.cases[0].observations = []; },
    r => { r.cases[0].observations[0].returned = false; },
    r => { r.cases.find((c: any) => c.runtimeError).runtimeError.message = 'forged error'; },
    r => { r.cases.find((c: any) => c.runtimeError).runtimeError = null; },
    r => { r.cases[0].traceEvents = LIMITS.traceEvents + 1; },
    r => { r.taskId = 'other'; }, r => { r.evidenceVerified = true; },
    r => { r.accounting.costUSD = 0; }, r => { r.outputUTF8Bytes = 0; },
    r => { r.solutionSHA256 = 'fake'; }, r => { r.localElapsedMs = -1; },
    r => { delete r.infrastructurePreflight; }, r => { r.infrastructurePreflight.localElapsedMs = ENGINE_SETUP_TIMEOUT_MS + 1; },
  ];
  for (const mutate of mutations) {
    const r = JSON.parse(original); mutate(r);
    assert.notDeepEqual(r,baseline,'Tamper control must change evidence, not reassign an existing value');
    await writeFile(path, JSON.stringify(r));
    await assert.rejects(f.harness.summarize('unit'), /inconsistent/);
  }
  await writeFile(path, original);
  await rename(join(f.path, cell, 'grade.lock'), join(f.path, cell, 'saved-grade.lock'));
  await assert.rejects(f.harness.summarize('unit'), /ENOENT/);
});

test('mixed evidence labels are not an eligible native/synthetic ranking', async () => {
  const f = await fixture();
  for (const [i, cell] of f.cells.entries()) {
    await solution(f.path, cell);
    const report = await f.harness.grade('unit', cell);
    // A deliberately relabeled test record exercises incompatible evidence, not a native trial.
    if (i === 0) await writeFile(join(f.path, cell, 'report.json'), JSON.stringify({ ...report, evidenceKind: 'coordinator-declared-dot-assisted' }));
  }
  const summary = await f.harness.summarize('unit');
  assert.equal(summary.complete, true); assert.equal(summary.comparableEvidenceKind, false);
  assert.equal(summary.relativePayloadRankingEligible, false); assert.equal(summary.sensitivity, null);
});

test('UTF-8 proxies count visible bytes and exact prefixes, not invented tokens or price', () => {
  assert.equal(commonPrefixBytes('é🐱x', 'é🐱y'), 6);
  assert.equal(commonPrefixBytes('é', 'è'), 0);
  const p = payloadProxy([{ input: 'é🐱x', output: 'ok' }, { input: 'é🐱y', output: 'π' }]);
  assert.equal(p.inputBytes, 14); assert.equal(p.outputBytes, 4); assert.equal(p.hypotheticalRepeatPrefixBytes, 6);
  assert.equal(p.scenarios.length, 9); assert.equal(p.scenarios[0].units, 18);
  assert.equal(p.scenarios[2].units, 12.6); assert.equal(p.tokens, null); assert.equal(p.costUSD, null);
  assert.equal(p.actualCacheHits, null); assert.equal(p.actualCacheEligibility, null);
});
