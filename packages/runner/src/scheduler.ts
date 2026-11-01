/** Job scheduler: all attempts count; unknown spend invalidates monetary-budget runs. */
import type { Job, JobJSON, AttemptRecord, RunConfig, RunJSON } from "./types.ts";
import { assertCompleteProvenance } from "./provenance.ts";
import { FORMAT_VERSION } from "./types.ts";
import { writeJobJSON, writeRunJSON, createAttemptDir, createJobDir } from "./rundir.ts";
import { runJobAttempt } from "./job.ts";
import { join } from "node:path";
import { readAttemptCost, AttemptFailure, type CostSummary } from "./accounting.ts";

export type OnJobDone = (job: Job, result: JobJSON) => void;
export interface SchedulerOptions {
  jobs: Job[]; config: RunConfig; runPath: string; repoRoot: string; apiKey: string; baseURL: string;
  turnLimits: Record<string, number>; problemsDir: string; onJobDone?: OnJobDone;
  /** Deterministic execution seam; defaults to the real attempt implementation. */
  runAttempt?: typeof runJobAttempt;
  /** Host-only bounded provider; never serialized into run configuration. */
  estimated?: ReturnType<typeof import("./estimated.ts").boundEstimatedClient>;
  subscription?: ReturnType<typeof import("./subscription.ts").boundSubscriptionClient>;
}

/** Schedules bounded concurrent jobs and records each attempt's complete cost or lower bound. */
export async function runScheduler(opts: SchedulerOptions, runJSON: RunJSON): Promise<string | undefined> {
  if (!Number.isSafeInteger(opts.config.concurrency) || opts.config.concurrency < 1) throw new Error("concurrency must be a positive integer");
  const estimatedMode = opts.config.provider === "deepseek" && opts.config.usageMode === "estimated";
  if ((opts.config.provider === "deepseek" || opts.config.usageMode === "estimated") && !estimatedMode) throw new Error("Invalid DeepSeek usage mode");
  if (estimatedMode && (!opts.estimated || !opts.config.estimatedLimits || opts.config.concurrency !== 1)) throw new Error("DeepSeek requires bounded host runtime");
  if (opts.estimated && (!estimatedMode || opts.subscription)) throw new Error("Estimated runtime cannot be mixed with another provider");
  const bounded = opts.estimated ?? opts.subscription;
  const subscriptionMode = opts.config.provider === "chatgpt" && opts.config.usageMode === "subscription";
  if ((opts.config.provider === "chatgpt" || opts.config.usageMode === "subscription") && !subscriptionMode) throw new Error("Invalid provider/usage mode pairing");
  if (subscriptionMode && (!opts.subscription || !opts.config.subscriptionLimits || opts.config.concurrency !== 1)) throw new Error("Subscription campaigns require a bounded host client and serial execution");
  if (!subscriptionMode && !estimatedMode && (opts.config.budgetUsd === null || !Number.isFinite(opts.config.budgetUsd) || opts.config.budgetUsd <= 0)) throw new Error("Monetary campaigns require a positive finite dollar budget");
  const attempt = opts.runAttempt ?? runJobAttempt;
  const controller = new AbortController();
  let knownCostUsd = 0;
  let incomplete = false;
  let pass = 0, fail = 0, attempts = 0;
  let invalidReason: string | undefined;
  let next = 0;
  const fatalErrors: unknown[] = [];
  /** Preserves the first causal stop reason; all already-dispatched attempts still settle/account. */
  function stop(reason: string): void {
    invalidReason ??= reason;
    runJSON.status = { invalid: invalidReason };
    controller.abort();
  }
  /** Writes counters after attempts and terminal jobs, including exhausted failures. */
  function flush(): void {
    runJSON.totals = { jobs: pass + fail, attempts, costUsd: subscriptionMode || estimatedMode || incomplete ? null : knownCostUsd, knownCostUsd, pass, fail };
    if (estimatedMode) runJSON.estimatedUsage = opts.estimated!.snapshot();
    if (subscriptionMode) runJSON.subscriptionUsage = opts.subscription!.snapshot();
    writeRunJSON(opts.runPath, runJSON);
  }
  /** Executes one attempt only; diagnosis and another paid run require an explicit new campaign. */
  async function runOne(original: Job): Promise<void> {
    const job = { ...original, dir: original.dir ?? createJobDir(opts.runPath, original) };
    const estimateBefore = opts.estimated?.snapshot().knownEstimatedUsd ?? 0;
    const records: AttemptRecord[] = [];
    let jobKnown = 0;
    const reasons = new Set<string>();
    let durationMs = 0;
    let result: Awaited<ReturnType<typeof runJobAttempt>> | undefined;
    {
      const n = 0;
      createAttemptDir(job.dir, n);
      attempts++;
      let error: unknown;
      let failed = false;
      let cost: CostSummary;
      try {
        result = await attempt({ ...opts, job, provenance: runJSON.provenance, onProvenance: () => writeRunJSON(opts.runPath, runJSON), attempt: n, signal: controller.signal,
          onFailure: () => stop(`job-failed:${job.problem}.${job.framework}.${job.rep}`) });
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
      if (!subscriptionMode && !estimatedMode) {
        if (cost.costUsd === null) stop("cost-incomplete");
        else if (knownCostUsd >= opts.config.budgetUsd!) stop("budget");
      } else {
        // Only absent per-request USD is expected for subscription usage. Corrupt/missing
        // telemetry and unobserved lifecycle work still invalidate the campaign.
        if (bounded!.snapshot().incomplete || cost.knownCostUsd !== 0 ||
            cost.costIncompleteReasons.some(reason => !["missing-or-invalid-turn-cost", "incomplete-attempt-cost"].includes(reason))) {
          stop(estimatedMode ? "estimated-usage-incomplete" : "subscription-usage-incomplete");
        }
      }
      if (failed || result?.outcome !== "pass") stop(`job-failed:${job.problem}.${job.framework}.${job.rep}`);
      flush();
    }
    const outcome = result?.outcome ?? "fail";
    if (outcome === "pass") pass++; else fail++;
    const jobJSON: JobJSON = {
      format: FORMAT_VERSION, problem: job.problem, framework: job.framework, rep: job.rep,
      outcome, reason: result?.reason ?? null, attempts: records,
      costUsdAllAttempts: reasons.size ? null : jobKnown, knownCostUsdAllAttempts: jobKnown,
      ...(reasons.size ? { costIncompleteReasons: [...reasons] } : {}),
      ...(estimatedMode ? { estimatedCost: { basis: opts.estimated!.snapshot().priceBasis,
        estimatedUsd: opts.estimated!.snapshot().incomplete ? null : opts.estimated!.snapshot().knownEstimatedUsd - estimateBefore,
        knownEstimatedUsd: opts.estimated!.snapshot().knownEstimatedUsd - estimateBefore } } : {}),
      durationMs, rollups: result?.rollups,
    };
    writeJobJSON(job.dir, jobJSON);
    opts.onJobDone?.(original, jobJSON);
    flush();
  }
  /** Workers claim indices synchronously before awaiting, so no job is dispatched twice. */
  async function worker(): Promise<void> {
    while (!controller.signal.aborted && next < opts.jobs.length) {
      if ((subscriptionMode || estimatedMode) && bounded!.stopReason()) { stop(bounded!.stopReason()!); break; }
      const job = opts.jobs[next++]!;
      try { await runOne(job); }
      catch (error) {
        // Artifact/observer failures also stop spend; drain siblings before reporting the error.
        fatalErrors.push(error);
        stop(`scheduler-error:${job.problem}.${job.framework}.${job.rep}`);
        try { flush(); } catch (writeError) { fatalErrors.push(writeError); }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, opts.config.concurrency) }, () => worker()));
  if (fatalErrors.length) throw new AggregateError(fatalErrors, "campaign stopped after scheduler error; inspect preserved attempt evidence");
  // No successful completion, including injected attempts, may bypass the evidence gate.
  if (!invalidReason) {
    try { assertCompleteProvenance(runJSON.provenance, opts.config); }
    catch { stop("provenance-incomplete"); flush(); }
  }
  return invalidReason;
}
