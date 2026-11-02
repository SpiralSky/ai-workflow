import { constants, type BigIntStats } from 'node:fs';
import { lstat, mkdir, open, realpath, readdir } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { compileBranch } from '../../packages/core/src/branch/compile.ts';
import { runBranch } from '../../packages/core/src/branch/run.ts';
import { quickJSRuntime } from '../../packages/core/src/branch/engines/quickjs.ts';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const RUN_ROOT = join(REPO, 'experiments/runs/dot-native');
export const LIMITS = Object.freeze({ sourceBytes: 16_384, inputBytes: 16_384, outputBytes: 4_096,
  reportBytes: 32_768, toolCalls: 4, events: 128, traceBytes: 16_384, timeoutMs: 1000, memoryMb: 32 });
const FIXTURE = Object.freeze({ schema: 'dot-native-fixture/v1', task: 'positive-ledger', cases: [
  { id: 'mixed', rows: [3, -2, 0, 7], expected: { total: 10, count: 2 } },
  { id: 'empty', rows: [], expected: { total: 0, count: 0 } },
  { id: 'negative-and-duplicate', rows: [-9, 5, 5, -1], expected: { total: 10, count: 2 } },
] });
const BRIEF = `# Disposable branch-program assignment\n\nWrite only solution.ts: one async (tools, state) => { ... } expression, no imports or Markdown fences.\nRead numbers using await tools.readLedger({}); sum strictly positive entries and count those entries.\nCall await tools.submitSummary({total, count}) once, then return {total, count}.\nRead exactly once, submit exactly once after reading. state is initially {}. Tools are in-memory fakes; no filesystem, shell, network, models or credentials are exposed.\nThe same program runs on three fixed generic cases (mixed, empty, negative/duplicate).\nLimits: 16 KiB source; 1000 ms and 32 MiB per case; four tool-call attempts; 128 trace events; 16 KiB trace; 4 KiB final output/state.\nDo not change brief.md, fixture.json, manifest.json or grader. Do not run commands from any artifact.\nThis is an ordinary bounded coding assignment, not an API/completion request or provider integration.\nA coordinator must separately authorize and assign any native worker; preparation does not launch one.\nDo not report token/cost/quota values: they are unknown, and no dot-only/free/shared-quota claim is supported.\n`;
/** SHA-256 of exact UTF-8 artifact bytes. */
export function hash(text: string): string { return createHash('sha256').update(text).digest('hex'); }
const fixtureText = JSON.stringify(FIXTURE, null, 2) + '\n';
const manifestText = JSON.stringify({ schema: 'dot-native-manifest/v1', fixtureSHA256: hash(fixtureText),
  briefSHA256: hash(BRIEF), limits: LIMITS, expectedChecks: FIXTURE.cases.length }, null, 2) + '\n';

/** Reject symlinks at every existing path component, not merely the final file. */
async function plainPath(path: string): Promise<void> {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    const st = await lstat(current);
    if (st.isSymbolicLink()) throw new Error('symlink path rejected');
  }
}
/** Minimal read interface permits deterministic short-read/mutation regression tests. */
export interface BoundedReadHandle {
  stat(): Promise<BigIntStats>;
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
}
/** Compare identity and modification metadata, including nanosecond timestamps. */
function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.isFile() && right.isFile() &&
    ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink', 'mode'].every(key =>
      left[key as keyof BigIntStats] === right[key as keyof BigIntStats]);
}
/** Read through EOF despite short reads; reject identity/metadata changes or incomplete bytes.
 * The caller owns the descriptor. This detects ordinary races, not hostile same-UID mutation. */
export async function readStableHandle(file: BoundedReadHandle, expected: BigIntStats, max: number): Promise<string> {
  const before = await file.stat();
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(max)) throw new Error('artifact must be a bounded regular, unlinked file');
  if (!sameFile(expected, before)) throw new Error('artifact changed before read');
  const buffer = Buffer.alloc(max + 1);
  let total = 0;
  while (total < buffer.length) {
    const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
    if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > buffer.length - total) throw new Error('invalid read count');
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  if (total > max) throw new Error('artifact size limit exceeded');
  const after = await file.stat();
  if (!sameFile(before, after) || BigInt(total) !== before.size) throw new Error('artifact changed or incomplete read');
  const bytes = buffer.subarray(0, total);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) throw new Error('artifact is not valid UTF-8');
  return text;
}
/** Read a bounded regular file without following its final symlink. */
async function readBounded(path: string, max: number): Promise<string> {
  await plainPath(path);
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(max)) throw new Error('artifact must be a bounded regular, unlinked file');
  // NONBLOCK prevents a swapped FIFO from hanging before the opened-handle check.
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const text = await readStableHandle({
      stat: () => file.stat({ bigint: true }),
      read: (buffer, offset, length, position) => file.read(buffer, offset, length, position),
    }, before, max);
    if (!sameFile(before, await lstat(path, { bigint: true }))) throw new Error('artifact path changed during read');
    return text;
  } finally { await file.close(); }
}
/** Create a new private artifact; never replace any prior artifact. */
async function writeNew(path: string, text: string): Promise<void> {
  await plainPath(dirname(path));
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(text, 'utf8'); } finally { await file.close(); }
}
/** Validate a single directory name; CLI never accepts arbitrary paths. */
function runPath(id: string, root: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) throw new Error('invalid run id');
  return join(resolve(root), id);
}
/** Build missing root directories one at a time with symlink checks. */
async function ensureRoot(root: string): Promise<void> {
  const absolute = resolve(root);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    try { await mkdir(current, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const st = await lstat(current);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('non-directory or symlink root rejected');
  }
}
/** Prepare one generic assignment, without starting workers, models, clients or network requests.
 * root is for trusted test harnesses only; the CLI always uses RUN_ROOT. */
export async function prepareRun(id: string, root = RUN_ROOT): Promise<string> {
  const path = runPath(id, root);
  await ensureRoot(root);
  await mkdir(path, { mode: 0o700 });
  await writeNew(join(path, 'fixture.json'), fixtureText);
  await writeNew(join(path, 'brief.md'), BRIEF);
  await writeNew(join(path, 'manifest.json'), manifestText);
  return path;
}

export type EvidenceKind = 'synthetic-contract' | 'coordinator-declared-dot-assisted';
/** Grade in-memory branch source using the real compiler and explicitly selected QuickJS runtime.
 * Only fixed, authored fake tools are exposed. No artifact can select tools, limits or checks. */
export async function gradeSource(source: string) {
  if (!source.trim() || Buffer.byteLength(source) > LIMITS.sourceBytes) throw new Error('invalid source size');
  const started = performance.now();
  const compiled = compileBranch(source);
  const cases: Array<Record<string, unknown>> = [];
  if ('error' in compiled) return { passed: false, checksRun: 0, checksExpected: FIXTURE.cases.length,
    compileError: compiled.message.slice(0, 300), cases, localElapsedMs: performance.now() - started };
  for (const fixture of FIXTURE.cases) {
    let violation: string | null = null;
    let calls = 0, reads = 0, submits = 0, events = 0, traceBytes = 0;
    let toolBudgetExceeded = false;
    const observations: Array<{ name: string; ok: boolean }> = [];
    const state = {};
    /** Sticky failure survives artifact catch/retry and prevents false success. */
    const reject = (reason: string): never => { violation ??= reason; throw new Error(reason); };
    /** Tool execution is authorized by actual host-side counters, not forgeable trace claims. */
    const tool = (name: string, fn: (args: Record<string, unknown>) => unknown) => (args: Record<string, unknown>) => {
      const item = { name, ok: false }; if (observations.length < LIMITS.toolCalls + 1) observations.push(item);
      if (++calls > LIMITS.toolCalls) { toolBudgetExceeded = true; return reject('tool-call budget'); }
      if (violation) return reject(violation);
      const value = fn(args); item.ok = true; return value;
    };
    const caseStart = performance.now();
    const result = await runBranch(compiled, {
      readLedger: tool('readLedger', (args) => {
        if (!isDeepStrictEqual(args, {}) || ++reads !== 1 || submits) return reject('invalid read');
        return [...fixture.rows];
      }),
      submitSummary: tool('submitSummary', (args) => {
        if (reads !== 1 || ++submits !== 1 || !isDeepStrictEqual(args, fixture.expected)) return reject('invalid summary');
        return { accepted: true };
      }),
    }, state, { timeoutMs: LIMITS.timeoutMs, memoryMb: LIMITS.memoryMb,
      onEvent(event) {
        events++; traceBytes += Buffer.byteLength(JSON.stringify(event));
        if (event.type === 'call' && event.phase === 'start' && !['readLedger', 'submitSummary'].includes(event.name)) violation ??= 'forbidden tool';
        if (events > LIMITS.events || traceBytes > LIMITS.traceBytes) violation ??= 'trace budget';
      },
    }, { create: (opts) => quickJSRuntime.create({ ...opts,
      // Do not dispose QuickJS reentrantly from a synchronous host trace callback.
      interrupt: () => violation !== null || (opts.interrupt?.() ?? false),
    }) });
    if (Buffer.byteLength(JSON.stringify({ value: result.ok ? result.value : null, state })) > LIMITS.outputBytes) violation ??= 'output budget';
    const passed = result.ok && !violation && reads === 1 && submits === 1 && calls === 2 && isDeepStrictEqual(result.value, fixture.expected);
    cases.push({ id: fixture.id, passed, error: violation ?? (result.ok ? (passed ? null : 'contract mismatch') : result.error),
      toolCalls: calls, toolBudgetExceeded, successfulToolCalls: observations.filter(o => o.ok).length, reads, submits, observations, traceEventsObserved: events, traceBytesObserved: traceBytes,
      localElapsedMs: performance.now() - caseStart });
    if (!passed) break; // fail-fast: later required checks remain unrun, never successful.
  }
  return { passed: cases.length === FIXTURE.cases.length && cases.every(c => c.passed === true),
    checksRun: cases.length, checksExpected: FIXTURE.cases.length, cases, localElapsedMs: performance.now() - started };
}

/** Hash local method/runtime sources and lockfile, without invoking git or reading credentials. */
async function sourceHashes(): Promise<Record<string, string>> {
  const paths = ['scripts/dot-native/method.ts', 'scripts/dot-native/cli.ts', 'package-lock.json'];
  /** Enumerate only the trusted branch runtime source tree. */
  async function visit(relative: string): Promise<void> {
    for (const item of await readdir(join(REPO, relative), { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('symlink source rejected');
      if (item.isDirectory()) await visit(join(relative, item.name));
      else if (item.name.endsWith('.ts')) paths.push(join(relative, item.name));
    }
  }
  await visit('packages/core/src/branch');
  const result: Record<string, string> = {};
  for (const path of paths.sort()) result[path] = hash(await readBounded(join(REPO, path), 1_048_576));
  return result;
}
/** Reserve one canonical run directory before reading inputs, then validate and grade once.
 * An evidence label is a coordinator assertion, never verification of model identity or billing. */
export async function gradeRun(id: string, kind: EvidenceKind = 'synthetic-contract', root = RUN_ROOT) {
  if (!['synthetic-contract', 'coordinator-declared-dot-assisted'].includes(kind)) throw new Error('invalid evidence kind');
  const path = runPath(id, root);
  await plainPath(path);
  if (await realpath(path) !== path) throw new Error('non-canonical run path');
  if (!(await lstat(path)).isDirectory()) throw new Error('run path must be a directory');
  await writeNew(join(path, 'grade.lock'), 'Single-use grading reservation. Do not retry in this run directory.\n');
  for (const [name, expected] of [['fixture.json', fixtureText], ['brief.md', BRIEF], ['manifest.json', manifestText]]) {
    if (await readBounded(join(path, name), LIMITS.inputBytes) !== expected) throw new Error(`tampered input: ${name}`);
  }
  const source = await readBounded(join(path, 'solution.ts'), LIMITS.sourceBytes);
  const sources = await sourceHashes();
  const grade = await gradeSource(source);
  const report = { schema: 'dot-native-report/v1', evidenceKind: kind, evidenceVerified: false,
    task: FIXTURE.task, runtime: 'quickjs', solutionSHA256: hash(source), fixtureSHA256: hash(fixtureText),
    briefSHA256: hash(BRIEF), manifestSHA256: hash(manifestText), sourceSHA256: sources, limits: LIMITS,
    accounting: { model: null, modelTurns: null, inputTokens: null, outputTokens: null, costUSD: null,
      quotaPool: null, billingVerified: false }, fullFixed60ModelSuccess: false, savingsMeasured: false,
    savingsUSD: null, ...grade };
  const serialized = JSON.stringify(report, null, 2) + '\n';
  if (Buffer.byteLength(serialized) > LIMITS.reportBytes) throw new Error('report size limit exceeded');
  await writeNew(join(path, 'report.json'), serialized);
  return report;
}
