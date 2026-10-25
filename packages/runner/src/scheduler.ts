/**
 * Job scheduler: runs jobs with bounded concurrency, tracks budget, handles retries.
 * Runner architecture §7; decided A-15 (interleave frameworks per problem).
 */

import type { Job, JobJSON, AttemptRecord, RunConfig } from "./types.ts";
import { FORMAT_VERSION } from "./types.ts";
import { writeJobJSON, writeRunJSON, createAttemptDir } from "./rundir.ts";
import type { RunJSON } from "./types.ts";
import type { JobOptions } from "./job.ts";
import { runJobAttempt } from "./job.ts";

/** Maximum infra-error retries before the run is marked invalid (runner §7). */
const MAX_RETRIES = 2;
/** Backoff delays between attempts in ms (runner §7). */
const RETRY_BACKOFF_MS = [10_000, 60_000] as const;

/** Called after each job completes (pass or fail). */
export type OnJobDone = (job: Job, result: JobJSON) => void;

/** Options for the scheduler. */
export interface SchedulerOptions {
  jobs: Job[];
  config: RunConfig;
  runPath: string;
  repoRoot: string;
  apiKey: string;
  baseURL: string;
  turnLimits: Record<string, number>;
  problemsDir: string;
  onJobDone?: OnJobDone;
}

/** Pauses for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Schedules and runs all jobs with bounded concurrency.
 * Tracks budget across all attempts; cancels in-flight when budget is exhausted.
 * Marks the run invalid after repeated infra errors.
 *
 * @param opts - scheduler options
 * @param runJSON - mutable run.json data (updated in place and written atomically after each job)
 * @returns reason if invalid, or undefined if complete
 */
export async function runScheduler(
  opts: SchedulerOptions,
  runJSON: RunJSON,
): Promise<string | undefined> {
  const { jobs, config } = opts;
  const budgetUsd = config.budgetUsd;

  let totalCostUsd = 0;
  let pass = 0;
  let fail = 0;
  let attempts = 0;
  let invalidReason: string | undefined;
  let stopDispatching = false;

  // AbortController shared across all in-flight jobs for budget cancellation
  const abortController = new AbortController();
  const signal = abortController.signal;

  const queue = [...jobs];
  const inFlight = new Set<Promise<void>>();

  /**
   * Runs one job through retry loop, updates totals and writes job.json.
   * @param job - job to run
   */
  async function runOne(job: Job): Promise<void> {
    const attemptRecords: AttemptRecord[] = [];
    let jobCostUsd = 0;

    for (let n = 0; n <= MAX_RETRIES; n++) {
      if (n > 0) {
        const delay = RETRY_BACKOFF_MS[n - 1] ?? 60_000;
        await sleep(delay);
      }

      const attemptDir = createAttemptDir(
        job.dir ?? `${opts.runPath}/${job.problem}.${job.framework}.${job.rep}`,
        n,
      );
      void attemptDir; // used by createAttemptDir internally

      attempts++;
      let result: Awaited<ReturnType<typeof runJobAttempt>>;
      let isInfra = false;
      let infraMsg: string | undefined;

      try {
        result = await runJobAttempt({
          job,
          config,
          runPath: opts.runPath,
          repoRoot: opts.repoRoot,
          apiKey: opts.apiKey,
          baseURL: opts.baseURL,
          signal,
          turnLimits: opts.turnLimits,
          problemsDir: opts.problemsDir,
        });
        jobCostUsd += result.costUsd;
        totalCostUsd += result.costUsd;
      } catch (e) {
        // Treat as infra error for retry
        isInfra = true;
        infraMsg = e instanceof Error ? e.message : String(e);
        attemptRecords.push({ n, infraError: infraMsg, costUsd: 0 });

        if (n < MAX_RETRIES) continue; // retry
        // Exhausted retries
        stopDispatching = true;
        abortController.abort();
        invalidReason = `job-failed:${job.problem}.${job.framework}.${job.rep}`;
        const jobJSON: JobJSON = {
          format: FORMAT_VERSION,
          problem: job.problem,
          framework: job.framework,
          rep: job.rep,
          outcome: "fail",
          reason: null,
          attempts: attemptRecords,
          costUsdAllAttempts: jobCostUsd,
          durationMs: 0,
        };
        writeJobJSON(job.dir ?? opts.runPath, jobJSON);
        fail++;
        opts.onJobDone?.(job, jobJSON);
        return;
      }

      if (!isInfra) {
        attemptRecords.push({ n, final: true });
        const outcome = result!.outcome;
        if (outcome === "pass") pass++;
        else fail++;

        const jobJSON: JobJSON = {
          format: FORMAT_VERSION,
          problem: job.problem,
          framework: job.framework,
          rep: job.rep,
          outcome,
          reason: result!.reason,
          attempts: attemptRecords,
          costUsdAllAttempts: jobCostUsd,
          durationMs: result!.durationMs,
          rollups: result!.rollups,
        };
        writeJobJSON(job.dir ?? opts.runPath, jobJSON);
        opts.onJobDone?.(job, jobJSON);
        break;
      }
    }

    // Check budget after each job
    if (totalCostUsd >= budgetUsd && !signal.aborted) {
      abortController.abort();
      stopDispatching = true;
      invalidReason = "budget";
    }

    // Write updated run.json totals
    runJSON.totals = { jobs: pass + fail, attempts, costUsd: totalCostUsd, pass, fail };
    writeRunJSON(opts.runPath, runJSON);
  }

  // Dispatch jobs up to concurrency
  async function dispatch(): Promise<void> {
    while (queue.length > 0 && !stopDispatching && inFlight.size < config.concurrency) {
      const job = queue.shift()!;
      const p = runOne(job).finally(() => {
        inFlight.delete(p);
        // Try to dispatch more when a slot frees up
        void dispatch();
      });
      inFlight.add(p);
    }
  }

  await dispatch();
  // Wait for all in-flight jobs to finish
  while (inFlight.size > 0) {
    await Promise.race(inFlight);
  }

  return invalidReason;
}
