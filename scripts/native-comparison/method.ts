import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { compileBranch } from '../../packages/core/src/branch/compile.ts';
import { runBranch } from '../../packages/core/src/branch/run.ts';
import { quickJSRuntime } from '../../packages/core/src/branch/engines/quickjs.ts';
import { hash } from '../dot-native/method.ts';
import { hashTrees, loadCatalog, type CatalogSnapshot } from './catalog.ts';
import { ensureRoot, existingRun, readText, runPath, writeNew } from './files.ts';
import { payloadProxy } from './proxy.ts';
import { TASKS } from './tasks.ts';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const RUN_ROOT = join(REPO, 'experiments/runs/native-comparison');
export const LIMITS = Object.freeze({ sourceBytes: 16_384, outputBytes: 4_096, reportBytes: 1_048_576,
  toolCalls: 4, traceEvents: 128, traceBytes: 16_384, timeoutMs: 1000, memoryMb: 32 });
export const ENGINE_SETUP_TIMEOUT_MS = 10_000;
export type EvidenceKind = 'synthetic-contract' | 'coordinator-declared-dot-assisted';
type Task = typeof TASKS[number];
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const RESERVATION = 'Single-use attempt reservation. Do not repair or retry this cell.\n';

/** Prepare a common empty engine before artifact deadlines; no code, bridge or tools are loaded.
 * Late asynchronous construction is disposed even after the infrastructure deadline expires.
 * A synchronous constructor overrun is detected on return, not forcibly preempted by Node timers.
 */
export async function prepareEngine(
  runtime: { create(opts: { memoryMb: number }): Promise<{ dispose(): void }> } = quickJSRuntime,
  timeoutMs = ENGINE_SETUP_TIMEOUT_MS,
) {
  const started = performance.now(); let timer: NodeJS.Timeout | undefined;
  const preparation = (async () => { const empty = await runtime.create({ memoryMb: LIMITS.memoryMb }); empty.dispose(); })();
  try {
    await Promise.race([preparation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('setup timeout')), timeoutMs);
    })]);
    const localElapsedMs = performance.now() - started;
    if (localElapsedMs > timeoutMs) throw new Error('setup timeout');
    return { runtime: 'quickjs', operation: 'empty-isolate-create-dispose', timeoutMs, localElapsedMs };
  } catch (error) { throw new Error(`QuickJS infrastructure preflight failed: ${String(error)}`); }
  finally { clearTimeout(timer); }
}

/** Measure this public task brief only, not coordinator instructions or native task metadata. */
function brief(task: Task, snippets: CatalogSnapshot['snippets']): string {
  const patterns = snippets.length ? '\nKnown-good patterns (adapt them; do not copy blindly):\n' +
    snippets.map(h => `// ${h.id}: ${h.description}\n\`\`\`ts\n${h.code}\n\`\`\``).join('\n') + '\n' : '';
  return `# One bounded branch-program assignment\n\nReturn only one async (tools, state) => { ... } expression, without imports or Markdown fences. Do not call any native tools, inspect files, ask other workers, or access graders/reference solutions. Do not modify anything. The coordinator will copy your returned text into solution.ts and grade it after submission. There is no feedback or repair round in this assignment.\n\nThis is an ordinary one-way coding assignment, not a model API, completion endpoint, planner/executor loop, or request to launch another agent. The program will run in QuickJS with only the in-memory tools described below. The same program must satisfy every case of the public contract.\n\nLimits: ${LIMITS.sourceBytes} UTF-8 source bytes; ${LIMITS.timeoutMs} ms and ${LIMITS.memoryMb} MiB per case; at most ${LIMITS.toolCalls} host attempts, ${LIMITS.traceEvents} trace events, ${LIMITS.traceBytes} trace bytes, and ${LIMITS.outputBytes} final output/state bytes. No filesystem, network, shell, model, or credentials are exposed to the program.\n\nNative model identity, tokens, hidden context, reasoning, turns, cache behavior, actual price and quota are unknown; do not invent them.\n\n## Task\n${task.instruction}\n\n${task.publicContract}\n${patterns}`;
}

/** Freeze the same source, cases and contract for both arms; native actor identity is not inferred. */
export async function experiment(catalog: CatalogSnapshot) {
  const sourceSHA256 = await hashTrees(REPO,
    ['scripts/native-comparison', 'packages/core/src/branch', 'packages/telemetry/src'],
    ['scripts/dot-native/method.ts', 'package-lock.json']);
  const selected = TASKS.map(task => catalog.select(task.instruction, task.toolNames));
  if (TASKS.length !== 2 || TASKS.some(task => task.cases.length === 0)) throw new Error('positive fixed two-task design required');
  if (selected.some(snippets => snippets.length === 0)) throw new Error('pilot needs a real selected snippet in each task; do not dispatch an empty treatment');
  const cells = TASKS.flatMap((task, i) => (i % 2 === 0 ? ['off', 'on'] : ['on', 'off']).map(arm => ({
    id: `${task.id}-${arm}`, taskId: task.id, arm,
    brief: brief(task, arm === 'on' ? selected[i] : []),
    snippets: arm === 'on' ? selected[i].map(s => s.id) : [],
    checksExpected: task.cases.length,
  })));
  const manifest = { schema: 'native-comparison-manifest/v2', protocol: 'two-tasks-presentation-only-AB-BA-contract-branches-v2',
    sourceSHA256, checksSHA256: hash(json(TASKS.map(t => ({ id: t.id, cases: t.cases })))),
    catalog: { kind: catalog.kind, reviewedSourceTree: catalog.reviewedSourceTree, reviewedPublishedCommit: catalog.reviewedPublishedCommit, observedCheckoutCommit: catalog.observedCheckoutCommit, catalogSHA256: catalog.catalogSHA256, sourceSHA256: catalog.sourceSHA256 },
    limits: LIMITS, enginePreparation: { operation: 'empty-isolate-create-dispose-before-artifact-deadline', timeoutMs: ENGINE_SETUP_TIMEOUT_MS },
    cells: cells.map(({ brief, ...cell }) => ({ ...cell, briefSHA256: hash(brief), inputUTF8Bytes: Buffer.byteLength(brief) })),
    nativeAssignmentsMaximum: 4, repetitions: 1, modelIdentityVerified: false,
    measurementScope: 'public-task-brief-and-source-artifact-only; coordinator instructions and task metadata excluded',
    fullOrchestrateBenchmark: false, fullFixed60ModelSuccess: false,
    isolation: 'prompt-only procedural isolation; shared executor files are not technically inaccessible',
    unknowns: ['native model', 'coordinator instructions', 'task metadata', 'hidden context', 'hidden reasoning', 'native turns', 'actual tokens', 'actual cache hits', 'actual price', 'quota'],
  };
  return { cells, manifest, text: json(manifest) };
}

/** Prepare only local artifacts. There is no worker/model dispatch in this module. */
async function prepare(id: string, getCatalog: () => Promise<CatalogSnapshot>, root: string) {
  const plan = await experiment(await getCatalog());
  const infrastructurePreflight = await prepareEngine();
  await ensureRoot(root); const path = runPath(root, id); await mkdir(path, { mode: 0o700 });
  await writeNew(join(path, 'manifest.json'), plan.text);
  await writeNew(join(path, 'engine-preflight.json'), json(infrastructurePreflight));
  for (const cell of plan.cells) {
    await mkdir(join(path, cell.id), { mode: 0o700 });
    await writeNew(join(path, cell.id, 'brief.md'), cell.brief);
  }
  return { path, cells: plan.cells.map(c => c.id), assignmentsLaunched: 0, infrastructurePreflight };
}

/** Execute one artifact on all fixed cases; every observed protocol violation is sticky. */
export async function gradeSource(task: Task, source: string) {
  if (!task.cases.length || new Set(task.cases.map(c => c.id)).size !== task.cases.length) throw new Error('positive unique contract cases required');
  if (task.cases.some(c => Object.hasOwn(c, 'expected') === Object.hasOwn(c, 'expectedError') ||
      (Object.hasOwn(c, 'expectedError') && (typeof c.expectedError !== 'string' || !c.expectedError ||
        c.expectedError.length > 300 || c.calls.at(-1)?.error !== c.expectedError)))) {
    throw new Error('each case requires exactly one return or expected final host error');
  }
  if (!source.trim() || Buffer.byteLength(source) > LIMITS.sourceBytes) throw new Error('invalid source size');
  const infrastructurePreflight = await prepareEngine();
  const started = performance.now(); const compiled = compileBranch(source);
  const cases: Array<Record<string, unknown>> = [];
  if ('error' in compiled) return { passed: false, status: 'task-failure', checksRun: 0, checksExpected: task.cases.length,
    compileError: compiled.message.slice(0, 300), cases, infrastructurePreflight, localElapsedMs: performance.now() - started };
  for (const fixture of task.cases) {
    let violation: string | null = null; let calls = 0, unknownCalls = 0, events = 0, traceBytes = 0;
    const observations: Array<{ name: string; accepted: boolean; returned: boolean }> = [];
    const state = structuredClone(fixture.state);
    const reject = (reason: string): never => { violation ??= reason; throw new Error(reason); };
    const tools = Object.fromEntries(task.toolNames.map(name => [name, (args: Record<string, unknown>) => {
      const observation = { name, accepted: false, returned: false };
      if (observations.length <= LIMITS.toolCalls) observations.push(observation);
      const expected = fixture.calls[calls++];
      if (calls > LIMITS.toolCalls) return reject('tool-call budget');
      if (violation) return reject(violation);
      if (!expected || expected.name !== name || !isDeepStrictEqual(args, expected.args)) return reject('unexpected tool call or arguments');
      observation.accepted = true;
      if (expected.error !== undefined) throw new Error(expected.error);
      observation.returned = true; return structuredClone(expected.result);
    }]));
    const caseStarted = performance.now();
    const result = await runBranch(compiled, tools, state, { timeoutMs: LIMITS.timeoutMs, memoryMb: LIMITS.memoryMb,
      onEvent(event) {
        events++; traceBytes += Buffer.byteLength(JSON.stringify(event));
        if (event.type === 'call' && event.phase === 'start' && !task.toolNames.includes(event.name)) { unknownCalls++; violation ??= 'forbidden tool'; }
        if (events > LIMITS.traceEvents || traceBytes > LIMITS.traceBytes) violation ??= 'trace budget';
      } }, { create: opts => quickJSRuntime.create({ ...opts, interrupt: () => violation !== null || (opts.interrupt?.() ?? false) }) });
    if (Buffer.byteLength(JSON.stringify({ value: result.ok ? result.value : null, state })) > LIMITS.outputBytes) violation ??= 'output budget';
    if (task.id === 'located-line-record' && !isDeepStrictEqual(state, fixture.state)) violation ??= 'state mutation';
    const matches = fixture.expectedError === undefined ? result.ok && isDeepStrictEqual(result.value, fixture.expected)
      : !result.ok && result.error === 'thrown' && result.message === fixture.expectedError;
    const passed = !violation && calls === fixture.calls.length && matches;
    cases.push({ id: fixture.id, passed, error: passed ? null : violation ?? (result.ok ? 'contract mismatch' : result.error),
      runtimeError: result.ok ? null : { code: result.error, message: result.message.slice(0, 300) },
      toolCalls: calls + unknownCalls, acceptedToolCalls: observations.filter(o => o.accepted).length,
      returnedToolCalls: observations.filter(o => o.returned).length, unknownToolCalls: unknownCalls, observations,
      traceEvents: events, traceBytes, localElapsedMs: performance.now() - caseStarted });
    if (!passed) break;
  }
  const passed = cases.length === task.cases.length && cases.every(c => c.passed === true);
  return { passed, status: passed ? 'passed' : 'task-failure', checksRun: cases.length, checksExpected: task.cases.length,
    cases, infrastructurePreflight, localElapsedMs: performance.now() - started };
}

/** Reserve before reading any input; rejection consumes this cell and never overwrites evidence. */
async function grade(id: string, cellId: string, getCatalog: () => Promise<CatalogSnapshot>, kind: EvidenceKind, root: string) {
  if (!['synthetic-contract', 'coordinator-declared-dot-assisted'].includes(kind)) throw new Error('invalid evidence kind');
  const possible = TASKS.flatMap(t => [`${t.id}-off`, `${t.id}-on`]);
  if (!possible.includes(cellId)) throw new Error('invalid cell id');
  const path = await existingRun(root, id); const cellPath = await existingRun(path, cellId);
  await writeNew(join(cellPath, 'grade.lock'), RESERVATION);
  const plan = await experiment(await getCatalog());
  if (await readText(join(path, 'manifest.json'), LIMITS.reportBytes) !== plan.text) throw new Error('manifest/source/catalog changed');
  const cell = plan.cells.find(c => c.id === cellId)!;
  if (await readText(join(cellPath, 'brief.md'), 65_536) !== cell.brief) throw new Error('assignment changed');
  const source = await readText(join(cellPath, 'solution.ts'), LIMITS.sourceBytes);
  const task = TASKS.find(t => t.id === cell.taskId)!;
  const grade = await gradeSource(task, source);
  const report = { schema: 'native-comparison-report/v2', evidenceKind: kind, evidenceVerified: false,
    cellId, taskId: cell.taskId, arm: cell.arm, manifestSHA256: hash(plan.text), solutionSHA256: hash(source),
    briefSHA256: hash(cell.brief), inputUTF8Bytes: Buffer.byteLength(cell.brief), outputUTF8Bytes: Buffer.byteLength(source),
    runtime: 'quickjs', accounting: { model: null, tokens: null, modelTurns: null, costUSD: null, quota: null, actualCacheHits: null },
    fullOrchestrateBenchmark: false, fullFixed60ModelSuccess: false, ...grade };
  const text = json(report); if (Buffer.byteLength(text) > LIMITS.reportBytes) throw new Error('report too large');
  await writeNew(join(cellPath, 'report.json'), text);
  return report;
}

/** Reject internally inconsistent reports before any aggregate success/proxy claim.
 * This is schema validation, not protection from a coordinator rewriting all evidence coherently.
 */
function validateReport(report: Awaited<ReturnType<typeof gradeRun>>, task: Task, source: string, input: string): void {
  const invalid = () => { throw new Error('inconsistent report checks/accounting'); };
  if (!report || !['synthetic-contract', 'coordinator-declared-dot-assisted'].includes(report.evidenceKind) ||
      report.evidenceVerified !== false || report.runtime !== 'quickjs' ||
      report.fullOrchestrateBenchmark !== false || report.fullFixed60ModelSuccess !== false ||
      !isDeepStrictEqual(report.accounting, { model: null, tokens: null, modelTurns: null, costUSD: null, quota: null, actualCacheHits: null }) ||
      report.inputUTF8Bytes !== Buffer.byteLength(input) || report.outputUTF8Bytes !== Buffer.byteLength(source) ||
      report.taskId !== task.id || !Number.isFinite(report.localElapsedMs) || report.localElapsedMs < 0 ||
      report.checksExpected !== task.cases.length || !Array.isArray(report.cases) ||
      report.checksRun !== report.cases.length || report.cases.length > task.cases.length) invalid();
  const setup = report.infrastructurePreflight;
  if (!setup || setup.runtime !== 'quickjs' || setup.operation !== 'empty-isolate-create-dispose' ||
      setup.timeoutMs !== ENGINE_SETUP_TIMEOUT_MS || !Number.isFinite(setup.localElapsedMs) ||
      setup.localElapsedMs < 0 || setup.localElapsedMs > ENGINE_SETUP_TIMEOUT_MS) invalid();
  for (const [i, item] of report.cases.entries()) {
    if (item.id !== task.cases[i].id || typeof item.passed !== 'boolean' ||
        (i < report.cases.length - 1 && item.passed !== true)) invalid();
    for (const field of ['toolCalls', 'acceptedToolCalls', 'returnedToolCalls', 'unknownToolCalls', 'traceEvents', 'traceBytes']) {
      if (!Number.isSafeInteger(item[field]) || (item[field] as number) < 0) invalid();
    }
    if ((item.acceptedToolCalls as number) > (item.toolCalls as number) ||
        (item.returnedToolCalls as number) > (item.acceptedToolCalls as number) ||
        (item.unknownToolCalls as number) > (item.toolCalls as number)) invalid();
    if (!Number.isFinite(item.localElapsedMs) || (item.localElapsedMs as number) < 0 || !Array.isArray(item.observations) ||
        item.observations.length > LIMITS.toolCalls + 1 ||
        item.observations.some(o => !o || typeof o.name !== 'string' || typeof o.accepted !== 'boolean' || typeof o.returned !== 'boolean') ||
        item.observations.filter(o => o.accepted).length !== item.acceptedToolCalls ||
        item.observations.filter(o => o.returned).length !== item.returnedToolCalls) invalid();
    if (item.passed && (item.error !== null || item.toolCalls !== task.cases[i].calls.length || item.unknownToolCalls !== 0 ||
        !isDeepStrictEqual(item.runtimeError, task.cases[i].expectedError === undefined ? null : { code: 'thrown', message: task.cases[i].expectedError }) ||
        !isDeepStrictEqual(item.observations, task.cases[i].calls.map(c => ({ name: c.name, accepted: true, returned: c.error === undefined }))) ||
        (item.traceEvents as number) > LIMITS.traceEvents || (item.traceBytes as number) > LIMITS.traceBytes)) invalid();
  }
  const allPassed = report.cases.length === task.cases.length && report.cases.every(c => c.passed === true);
  if (report.passed !== allPassed || report.status !== (allPassed ? 'passed' : 'task-failure') ||
      (report.cases.length === 0 && (typeof report.compileError !== 'string' || !report.compileError.length)) ||
      (!allPassed && report.cases.length > 0 && report.cases.at(-1)!.passed !== false)) invalid();
}

/** Summarize all four planned cells, including absent/reserved failures. Never select a best retry. */
async function summarizeWithCatalog(id: string, getCatalog: () => Promise<CatalogSnapshot>, root: string) {
  const path = await existingRun(root, id); const plan = await experiment(await getCatalog());
  if (await readText(join(path, 'manifest.json'), LIMITS.reportBytes) !== plan.text) throw new Error('manifest/source/catalog changed');
  const results: Array<{ id: string; arm: string; status: string; report?: Awaited<ReturnType<typeof gradeRun>> }> = [];
  const payloads: Record<string, Array<{ input: string; output: string }>> = { off: [], on: [] };
  for (const cell of plan.cells) {
    const dir = await existingRun(path, cell.id);
    if (await readText(join(dir, 'brief.md'), 65_536) !== cell.brief) throw new Error('assignment changed');
    let report: Awaited<ReturnType<typeof gradeRun>>;
    try { report = JSON.parse(await readText(join(dir, 'report.json'), LIMITS.reportBytes)); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      let reserved = false;
      try {
        if (await readText(join(dir, 'grade.lock')) !== RESERVATION) throw new Error('changed reservation');
        reserved = true;
      } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
      results.push({ id: cell.id, arm: cell.arm, status: reserved ? 'reserved-without-report' : 'not-graded' }); continue;
    }
    if (await readText(join(dir, 'grade.lock')) !== RESERVATION) throw new Error('missing or changed reservation');
    const source = await readText(join(dir, 'solution.ts'), LIMITS.sourceBytes);
    if (report.schema !== 'native-comparison-report/v2' || report.cellId !== cell.id || report.arm !== cell.arm ||
        report.manifestSHA256 !== hash(plan.text) || report.solutionSHA256 !== hash(source) || report.briefSHA256 !== hash(cell.brief)) throw new Error('inconsistent report');
    validateReport(report, TASKS.find(t => t.id === cell.taskId)!, source, cell.brief);
    results.push({ id: cell.id, arm: cell.arm, status: report.status, report });
    payloads[cell.arm].push({ input: cell.brief, output: source });
  }
  const arms = ['off', 'on'].map(arm => {
    const cells = results.filter(r => r.arm === arm); const completed = cells.filter(c => c.report);
    const passed = cells.filter(c => c.report?.passed === true).length;
    const checksExpected = plan.cells.filter(c => c.arm === arm).reduce((n, c) => n + c.checksExpected, 0);
    return { arm, plannedTasks: 2, gradedTasks: completed.length, passedTasks: passed,
      taskSuccessFraction: `${passed}/2`, checksExpected,
      checksRun: completed.reduce((n, c) => n + c.report!.checksRun, 0),
      checksPassed: completed.reduce((n, c) => n + c.report!.cases.filter(k => k.passed === true).length, 0),
      fullRequiredArtifactSuccess: passed === 2, visiblePayloadProxy: payloadProxy(payloads[arm]),
      proxyCoverage: `${completed.length}/2 graded artifact payloads; undispatched or missing artifacts unknown` };
  });
  const reports = results.flatMap(r => r.report ? [r.report] : []);
  const evidenceKinds = [...new Set(reports.map(r => r.evidenceKind))];
  const eligible = reports.length === 4 && evidenceKinds.length === 1 && arms.every(a => a.fullRequiredArtifactSuccess);
  const sensitivity = eligible ? arms[0].visiblePayloadProxy.scenarios.map((off, i) => {
    const on = arms[1].visiblePayloadProxy.scenarios[i];
    return { outputWeight: off.outputWeight, repeatedPrefixWeight: off.repeatedPrefixWeight,
      onToOffVisiblePayloadRatio: on.units / off.units,
      lowerVisiblePayloadArm: on.units < off.units ? 'on' : on.units > off.units ? 'off' : 'tie' };
  }) : null;
  return { schema: 'native-comparison-summary/v2', manifestSHA256: hash(plan.text), results, arms,
    complete: reports.length === 4, evidenceKinds, comparableEvidenceKind: evidenceKinds.length === 1,
    relativePayloadRankingEligible: eligible, sensitivity,
    payloadRankingChangesWithWeights: sensitivity ? new Set(sensitivity.map(s => s.lowerVisiblePayloadArm)).size > 1 : null,
    claim: 'First-pass artifact contract observations only; no significance, native-model equality, total-price or live-orchestrate claim.' };
}

/** Real campaign preparation always admits the approved reviewed local source. */
export async function prepareRun(id: string, catalogRoot: string, root = RUN_ROOT) {
  return prepare(id, () => loadCatalog(catalogRoot), root);
}

/** Real campaign grading never accepts a catalog/module from the artifact. */
export async function gradeRun(id: string, cellId: string, catalogRoot: string, kind: EvidenceKind = 'synthetic-contract', root = RUN_ROOT) {
  return grade(id, cellId, () => loadCatalog(catalogRoot), kind, root);
}

/** Real campaign summaries revalidate the pinned local source and all artifacts. */
export async function summarize(id: string, catalogRoot: string, root = RUN_ROOT) {
  return summarizeWithCatalog(id, () => loadCatalog(catalogRoot), root);
}

/** Self-contained unit fixtures only; their manifest is permanently labeled synthetic catalog.
 * This explicit fixture path is not used by the CLI or real campaign admission.
 */
export function syntheticHarness(catalog: CatalogSnapshot, root: string) {
  if (catalog.kind !== 'synthetic-contract-fixture' || resolve(root) === RUN_ROOT) throw new Error('synthetic fixture root/catalog required');
  const getCatalog = async () => catalog;
  return {
    prepare: (id: string) => prepare(id, getCatalog, root),
    grade: (id: string, cell: string) => grade(id, cell, getCatalog, 'synthetic-contract', root),
    summarize: (id: string) => summarizeWithCatalog(id, getCatalog, root),
  };
}
