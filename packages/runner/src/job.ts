/**
 * Runs one job attempt end to end.
 * Runner architecture §4; job lifecycle §4.1–§4.4.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { basePrompt } from "@aiw/core";
import { createChatClient } from "@aiw/llm";
import { createReporter, writeJobStart, writeJobEnd, FileSink } from "@aiw/telemetry";
import type { Job, JobResult } from "./types.ts";
import type { RunConfig } from "./types.ts";
import { buildImage, startContainer, removeContainer, killContainer, startServer } from "./container.ts";
import { openMCPSession, closeMCPSession } from "./mcp.ts";
import { gradeJob } from "./grade.ts";
import { runLoop } from "./loop.ts";
import { createJobDir } from "./rundir.ts";
import { readAttemptCost, AttemptFailure } from "./accounting.ts";
import { frameworkLaunch } from "./framework-launch.ts";
import { attestJob, verifyStaticProvenance, inspectContainerImage } from "./provenance.ts";
import { onCancellation } from "./cancellation.ts";

/** Options for running a single job attempt. */
export interface JobOptions {
  job: Job;
  provenance?: import("./types.ts").Provenance;
  /** Persist observations before any model request; failure stops the attempt. */
  onProvenance?: () => void | Promise<void>;
  /** Zero-based retry number for per-attempt telemetry. */
  attempt?: number;
  config: RunConfig;
  runPath: string;
  repoRoot: string;
  /** API key for the LLM endpoint. */
  apiKey: string;
  /** LLM base URL. */
  baseURL: string;
  /** AbortSignal for budget and fail-fast cancellation. */
  signal?: AbortSignal;
  /** Host-only shared subscription gate; absent for the unchanged paid API client. */
  estimated?: ReturnType<typeof import("./estimated.ts").boundEstimatedClient>;
  subscription?: ReturnType<typeof import("./subscription.ts").boundSubscriptionClient>;
  /** Notify the campaign before terminal failure cleanup, so siblings stop promptly. */
  onFailure?: () => void;
  /** Per-problem turn limits override (task.json is the authoritative source; this is for overrides). */
  turnLimits: Record<string, number>;
  /** Path to the problem directories. */
  problemsDir: string;
}

/**
 * Reads task.md for the given problem.
 * @param problemsDir - path to experiments/problems/
 * @param problem - problem id
 * @throws Error if task.md is not found
 */
function readTaskText(problemsDir: string, problem: string): string {
  const taskPath = join(problemsDir, problem, "task.md");
  if (!existsSync(taskPath)) throw new Error(`task.md not found for problem ${problem}: ${taskPath}`);
  return readFileSync(taskPath, "utf8");
}

/**
 * Constructs the system prompt: base prompt + framework instructions placeholder.
 * Framework instructions come from the MCP server's `instructions` section (deferred to real impl).
 * @param frameworkInstructions - instructions from the MCP session (empty for stubs)
 */
function buildSystemPrompt(frameworkInstructions: string): string {
  const base = basePrompt();
  if (!frameworkInstructions) return base;
  return `${base}\n\n${frameworkInstructions}`;
}

/**
 * Runs one job attempt end to end: container → server → model loop → grade → result.
 * Returns JobResult; throws on unhandled errors (caller handles infra retries).
 * @param opts - job options
 * @returns job result
 */
export async function runJobAttempt(opts: JobOptions): Promise<JobResult> {
  const { job, config, runPath, repoRoot, apiKey, baseURL, signal, turnLimits, problemsDir } = opts;

  if (config.provider === "chatgpt" && (!opts.subscription || config.usageMode !== "subscription")) throw new Error("ChatGPT requires bounded subscription runtime");
  if (config.provider === "deepseek" && (!opts.estimated || config.usageMode !== "estimated")) throw new Error("DeepSeek requires bounded estimate runtime");
  if (opts.estimated && (config.provider !== "deepseek" || opts.subscription)) throw new Error("Estimated runtime cannot be mixed with another provider");
  const client = opts.estimated?.client ?? opts.subscription?.client ?? createChatClient({ baseURL, apiKey, timeoutMs: 300_000 });

  // Validate treatment before creating artifacts or starting any container.
  const launch = frameworkLaunch(job.framework, config);
  const jobDir = job.dir ?? createJobDir(runPath, job);
  const eventsPath = join(jobDir, "events.jsonl");
  const sink = new FileSink(eventsPath);
  const reporter = createReporter({ sink, writer: "r" });

  writeJobStart(reporter, {
    job: `${job.problem}.${job.framework}.${job.rep}`,
    attempt: opts.attempt ?? 0,
    framework: job.framework,
    problem: job.problem,
    rep: job.rep,
  });

  const startMs = Date.now();
  let outcome: "pass" | "fail" = "fail";
  let reason: JobResult["reason"] = null;
  let failure: unknown;
  let failed = false;
  const costReasons: string[] = [];
  let modelLoopStarted = false;

  const problemDir = join(problemsDir, job.problem);

  try {
    signal?.throwIfAborted();
    await buildImage(problemDir, job.problem);
    signal?.throwIfAborted();
    // Every executor uses the closed-until-attested host broker; task containers need no egress.
    const ctr = await startContainer(job.problem, jobDir, join(repoRoot, "packages", "server", "dist"), launch.network);

    const settleCancellation = onCancellation(signal, async () => {
      if (modelLoopStarted) costReasons.push("cancelled-container-lifecycle");
      try { await killContainer(ctr); }
      catch { costReasons.push("container-cancel-failed"); }
    });
    let session: Awaited<ReturnType<typeof openMCPSession>> | undefined;
    try {
      signal?.throwIfAborted();
      const serverArgs = [
        "--engine", "isolated-vm",
        "--framework", launch.id,
        "--tier", config.tier ?? "S",
        "--branch-context", config.branch.context,
        "--host", "local",
        "--root", "/work",
        "--events", "/out/events.jsonl",
        "--transcript", "/out/transcript.jsonl",
        "--blobs", "/out/blobs",
        ...launch.executorArgs,
      ];
      const serverDescriptor = await startServer(ctr, serverArgs);
      session = await openMCPSession(serverDescriptor, launch.needsExecutor
        ? { secondaryClient: client, secondaryModel: config.models.secondary, signal } : undefined);

      signal?.throwIfAborted();
      if (!opts.provenance || !opts.onProvenance) throw new Error("job lacks persisted provenance gate");
      verifyStaticProvenance(repoRoot, config, opts.provenance, job.problem);
      if (turnLimits[job.problem] !== undefined && turnLimits[job.problem] !== opts.provenance.problems[job.problem]?.turnLimit) throw new Error("turn-limit override differs from attested problem");
      attestJob(opts.provenance, config, job.problem, launch.id, await inspectContainerImage(ctr.id), session);
      await opts.onProvenance();
      signal?.throwIfAborted();
      const taskText = readTaskText(problemsDir, job.problem);
      const systemPrompt = buildSystemPrompt(session.instructions ?? "");

      // Read turnLimit from task.json; turnLimits map allows overrides, fallback to 20.
      const taskJsonPath = join(problemsDir, job.problem, "task.json");
      const taskJson = existsSync(taskJsonPath)
        ? (JSON.parse(readFileSync(taskJsonPath, "utf8")) as { turnLimit?: number })
        : {};
      const turnLimit = turnLimits[job.problem] ?? taskJson.turnLimit ?? 20;

      signal?.throwIfAborted();
      modelLoopStarted = true;
      session.inferenceAdmission?.open();
      const loopResult = await runLoop({
        client,
        reporter,
        session,
        systemPrompt,
        taskText,
        model: config.models.main,
        temperature: config.temperature,
        turnLimit,
        framework: job.framework,
        signal,
        onInfraError: opts.onFailure,
      });

      session.inferenceAdmission?.close();
      modelLoopStarted = false;
      costReasons.push(...(loopResult.metrics.costIncompleteReasons ?? []));

      if (loopResult.outcome === "infra-error") {
        costReasons.push("unobserved-failed-model-request");
        throw new Error(`infra error: ${loopResult.infraError}`);
      }
      if (loopResult.outcome === "turn-limit") {
        reason = "turn-limit";
      } else if (loopResult.outcome === "context-limit") {
        reason = "context-limit";
      } else {
        // Model finished; grade the result
        await closeMCPSession(session);
        session = undefined;
        signal?.throwIfAborted();
        verifyStaticProvenance(repoRoot, config, opts.provenance!, job.problem);
        const gradeResult = await gradeJob(ctr, problemDir, jobDir, opts.provenance!.images[job.problem]);
        signal?.throwIfAborted();
        verifyStaticProvenance(repoRoot, config, opts.provenance!, job.problem);
        if (gradeResult.pass) {
          outcome = "pass";
          reason = null;
        } else {
          reason = gradeResult.reason ?? "checks";
        }
      }
      if (outcome !== "pass") opts.onFailure?.();
    } catch (error) {
      opts.onFailure?.();
      throw error;
    } finally {
      if (session) {
        try { await closeMCPSession(session); }
        catch { costReasons.push("server-close-failed"); }
      }
      await settleCancellation();
      await removeContainer(ctr).catch(() => { costReasons.push("container-stop-failed"); });
    }
  } catch (e) {
    opts.onFailure?.();
    failure = e;
    failed = true;
    if (modelLoopStarted) costReasons.push("unobserved-failed-model-request");
  } finally {
    writeJobEnd(reporter, { outcome: failed ? "infra-error" : outcome, reason: reason ?? undefined });
    sink.close();
  }

  const durationMs = Date.now() - startMs;

  const cost = readAttemptCost(eventsPath, costReasons);
  if (failed) throw new AttemptFailure(failure, cost, eventsPath, durationMs);
  return { outcome, reason, ...cost, durationMs, eventsPath };
}

/**
 * Cancels a running job by killing its container if provided.
 * @param ctr - container handle (from startContainer), or undefined
 */
export async function cancelJob(ctr: import("./container.ts").Container | undefined): Promise<void> {
  if (ctr) await killContainer(ctr).catch(() => void 0);
}
