/** Job scheduler: all attempts count against one run budget; unknown spend invalidates the run. */
import type { Job, JobJSON, AttemptRecord, RunConfig, RunJSON } from "./types.ts";
import { assertCompleteProvenance } from "./provenance.ts";
import { FORMAT_VERSION } from "./types.ts";
import { writeJobJSON, writeRunJSON, createAttemptDir, createJobDir } from "./rundir.ts";
import { runJobAttempt } from "./job.ts";
import { join } from "node:path";
import { readAttemptCost, AttemptFailure, type CostSummary } from "./accounting.ts";
import { createCostMeter, type CostMeter } from "./cost-meter.ts";
import { PRICE_TABLE, type DecisionsClient } from "@aiw/llm";
import type { LLMClient } from "@aiw/telemetry";

export type OnJobDone = (job: Job, result: JobJSON) => void;
export interface SchedulerOptions {
  jobs: Job[]; config: RunConfig; runPath: string; repoRoot: string; apiKey: string; baseURL: string;
  turnLimits: Record<string, number>; problemsDir: string; onJobDone?: OnJobDone;
  /** Deterministic execution seam; defaults to the real attempt implementation. */
  runAttempt?: typeof runJobAttempt;
  /** Host-only direct main/secondary client (DeepSeek); never serialized into run configuration. */
  llmClient?: LLMClient;
  /** Host-only direct selection classifier (TypeSafe). */
  classifierClient?: DecisionsClient;
  /** ChatGPT plan usage: its client plus call/token/time limits on top of the budget. */
  subscription?: ReturnType<typeof import("./subscription.ts").boundSubscriptionClient>;
  /** Shared run cost meter; defaults to one built from `config.budgetUsd`. */
  meter?: CostMeter;
}

/**
 * Whether a plan run has no API-equivalent price for its models, so its cost is unknown.
 * @param config - run configuration
 */
export function planCostUnpriced(config: RunConfig): boolean {
  return config.provider === "chatgpt" && [config.models.main, config.models.secondary].some(m => !Object.hasOwn(PRICE_TABLE, m));
}

/** Schedules bounded concurrent jobs and records each attempt's complete cost or lower bound. */
export async function runScheduler(opts: SchedulerOptions, runJSON: RunJSON): Promise<string | undefined> {
  if (!Number.isSafeInteger(opts.config.concurrency) || opts.config.concurrency < 1) throw new Error("concurrency must be a positive integer");
  const provider = opts.config.provider ?? "openrouter";
  if (!Number.isFinite(opts.config.budgetUsd) || opts.config.budgetUsd <= 0) throw new Error("Runs require a positive finite dollar budget");
  if (provider === "deepseek" && (!opts.llmClient || opts.subscription || opts.config.concurrency !== 1)) throw new Error("DeepSeek requires the host client and serial execution");
  if (provider === "openai" && (!opts.llmClient || opts.subscription)) throw new Error("OpenAI requires the host client");
  if (provider === "chatgpt" && (!opts.subscription || opts.llmClient || !opts.config.subscriptionLimits || opts.config.concurrency !== 1)) throw new Error("Plan runs require a bounded host client and serial execution");
  if (provider === "openrouter" && (opts.llmClient || opts.subscription)) throw new Error("OpenRouter runs take no host client");
  if ((opts.config.classifier?.provider === "typesafe") !== (opts.classifierClient !== undefined)) throw new Error("Classifier runtime/provider mismatch");
  const costOptional = planCostUnpriced(opts.config);
  const meter = opts.meter ?? createCostMeter(opts.config.budgetUsd, { costOptional });
  const llmClient = opts.llmClient ?? opts.subscription?.client;
  const metered = {
    ...(llmClient ? { llmClient: meter.llm(llmClient) } : {}),
    ...(opts.classifierClient ? { classifierClient: meter.classifier(opts.classifierClient) } : {}),
  };
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
    runJSON.totals = { jobs: pass + fail, attempts, costUsd: incomplete ? null : knownCostUsd, knownCostUsd, pass, fail };
    if (opts.subscription) runJSON.subscriptionUsage = opts.subscription.snapshot();
    writeRunJSON(opts.runPath, runJSON);
  }
  /** Executes one attempt only; diagnosis and another paid run require an explicit new campaign. */
  async function runOne(original: Job): Promise<void> {
    const job = { ...original, dir: original.dir ?? createJobDir(opts.runPath, original) };
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
        result = await attempt({ ...opts, ...metered, meter, job, provenance: runJSON.provenance, onProvenance: () => writeRunJSON(opts.runPath, runJSON), attempt: n, signal: controller.signal,
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
      // Only absent per-turn USD is expected, and only for plan runs without a price. Corrupt or
      // missing telemetry and unobserved lifecycle work still invalidate the run.
      const tolerated = costOptional && !cost.costIncompleteReasons.some(reason => !["missing-or-invalid-turn-cost", "incomplete-attempt-cost"].includes(reason));
      if (meter.stopReason()) stop(meter.stopReason()!);
      else if (cost.costUsd === null && !tolerated) stop("cost-incomplete");
      else if (opts.subscription?.snapshot().incomplete) stop("subscription-usage-incomplete");
      else if (knownCostUsd >= opts.config.budgetUsd) stop("budget");
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
      durationMs, rollups: result?.rollups,
    };
    writeJobJSON(job.dir, jobJSON);
    opts.onJobDone?.(original, jobJSON);
    flush();
  }
  /** Workers claim indices synchronously before awaiting, so no job is dispatched twice. */
  async function worker(): Promise<void> {
    while (!controller.signal.aborted && next < opts.jobs.length) {
      const reason = meter.stopReason() ?? opts.subscription?.stopReason();
      if (reason) { stop(reason); break; }
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
