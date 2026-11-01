/** Job scheduler: all attempts count; unknown spend invalidates monetary-budget runs. */
import type { Job, JobJSON, AttemptRecord, RunConfig, RunJSON } from "./types.ts";
import { FORMAT_VERSION } from "./types.ts";
import { writeJobJSON, writeRunJSON, createAttemptDir, createJobDir } from "./rundir.ts";
import { runJobAttempt } from "./job.ts";
import { join } from "node:path";
import { readAttemptCost, AttemptFailure, type CostSummary } from "./accounting.ts";

const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [10_000, 60_000] as const;
export type OnJobDone = (job: Job, result: JobJSON) => void;
export interface SchedulerOptions {
  jobs: Job[]; config: RunConfig; runPath: string; repoRoot: string; apiKey: string; baseURL: string;
  turnLimits: Record<string, number>; problemsDir: string; onJobDone?: OnJobDone;
  /** Deterministic execution seam; defaults to the real attempt implementation. */
  runAttempt?: typeof runJobAttempt;
  /** Deterministic backoff seam; defaults to real timers. */
  wait?: (ms: number) => Promise<void>;
}

/** Schedules bounded concurrent jobs and records each attempt's complete cost or lower bound. */
export async function runScheduler(opts: SchedulerOptions, runJSON: RunJSON): Promise<string | undefined> {
  const attempt = opts.runAttempt ?? runJobAttempt;
  const wait = opts.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const controller = new AbortController();
  let knownCostUsd = 0;
  let incomplete = false;
  let pass = 0, fail = 0, attempts = 0;
  let invalidReason: string | undefined;
  let next = 0;
  /** Preserves the first causal stop reason; all already-dispatched attempts still settle/account. */
  function stop(reason: string): void {
    invalidReason ??= reason;
    controller.abort();
  }
  /** Writes counters after attempts and terminal jobs, including exhausted failures. */
  function flush(): void {
    runJSON.totals = { jobs: pass + fail, attempts, costUsd: incomplete ? null : knownCostUsd, knownCostUsd, pass, fail };
    writeRunJSON(opts.runPath, runJSON);
  }
  /** Executes one job and preserves raw retry artifacts before the next attempt. */
  async function runOne(original: Job): Promise<void> {
    const job = { ...original, dir: original.dir ?? createJobDir(opts.runPath, original) };
    const records: AttemptRecord[] = [];
    let jobKnown = 0;
    const reasons = new Set<string>();
    let durationMs = 0;
    let result: Awaited<ReturnType<typeof runJobAttempt>> | undefined;
    for (let n = 0; n <= MAX_RETRIES; n++) {
      if (n > 0) {
        await wait(RETRY_BACKOFF_MS[n - 1] ?? 60_000);
        if (controller.signal.aborted) break;
      }
      createAttemptDir(job.dir, n);
      attempts++;
      let error: unknown;
      let failed = false;
      let cost: CostSummary;
      try {
        result = await attempt({ ...opts, job, attempt: n, signal: controller.signal });
        cost = { costUsd: result.costUsd, knownCostUsd: result.knownCostUsd ?? result.costUsd ?? 0,
          costIncompleteReasons: [...(result.costIncompleteReasons ?? [])] };
        durationMs += result.durationMs;
      } catch (e) {
        error = e;
        failed = true;
        cost = e instanceof AttemptFailure
          ? { ...e.cost, costIncompleteReasons: [...e.cost.costIncompleteReasons] }
          : readAttemptCost(join(job.dir, "events.jsonl"), ["unaccounted-attempt-failure"]);
        if (e instanceof AttemptFailure) durationMs += e.durationMs;
      }
      if (!Number.isFinite(cost.knownCostUsd) || cost.knownCostUsd < 0) {
        cost = { costUsd: null, knownCostUsd: 0, costIncompleteReasons: [...cost.costIncompleteReasons, "invalid-known-cost"] };
      }
      if (cost.costUsd === null || !Number.isFinite(cost.costUsd) || cost.costUsd < 0 || cost.costIncompleteReasons.length) {
        incomplete = true;
        cost.costIncompleteReasons.push("incomplete-attempt-cost");
        cost.costUsd = null;
      }
      jobKnown += cost.knownCostUsd;
      knownCostUsd += cost.knownCostUsd;
      cost.costIncompleteReasons.forEach((reason) => reasons.add(reason));
      records.push({ n, costUsd: cost.costUsd, knownCostUsd: cost.knownCostUsd,
        ...(cost.costIncompleteReasons.length ? { costIncompleteReasons: [...new Set(cost.costIncompleteReasons)] } : {}),
        ...(failed ? { infraError: error instanceof Error ? error.message : String(error) } : { final: true as const }) });
      if (cost.costUsd === null) stop("cost-incomplete");
      else if (knownCostUsd >= opts.config.budgetUsd) stop("budget");
      flush();
      if (!failed || controller.signal.aborted) break;
      if (n === MAX_RETRIES) stop(`job-failed:${job.problem}.${job.framework}.${job.rep}`);
    }
    const outcome = result?.outcome ?? "fail";
    if (outcome === "pass") pass++; else fail++;
    const jobJSON: JobJSON = {
      format: FORMAT_VERSION, problem: job.problem, framework: job.framework, rep: job.rep,
      outcome, reason: result?.reason ?? null, attempts: records,
      costUsdAllAttempts: reasons.size ? null : jobKnown, knownCostUsdAllAttempts: jobKnown,
      ...(reasons.size ? { costIncompleteReasons: [...reasons] } : {}),
      durationMs, rollups: result?.rollups,
    };
    writeJobJSON(job.dir, jobJSON);
    opts.onJobDone?.(original, jobJSON);
    flush();
  }
  /** Workers claim indices synchronously before awaiting, so no job is dispatched twice. */
  async function worker(): Promise<void> {
    while (!controller.signal.aborted && next < opts.jobs.length) {
      const job = opts.jobs[next++]!;
      await runOne(job);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, opts.config.concurrency) }, () => worker()));
  return invalidReason;
}
