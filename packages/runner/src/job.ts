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

/** Options for running a single job attempt. */
export interface JobOptions {
  job: Job;
  /** Zero-based retry number for per-attempt telemetry. */
  attempt?: number;
  config: RunConfig;
  runPath: string;
  repoRoot: string;
  /** API key for the LLM endpoint. */
  apiKey: string;
  /** LLM base URL. */
  baseURL: string;
  /** AbortSignal for budget cancellation. */
  signal?: AbortSignal;
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

  // Validate treatment before creating artifacts or starting any container.
  const launch = frameworkLaunch(job.framework, config, { apiKey, baseURL });
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
    // Build image and start container (stubs in this implementation)
    await buildImage(problemDir, job.problem);
    // orchestrate executor makes LLM calls from inside the container; bridge gives outbound internet access
    const ctr = await startContainer(job.problem, jobDir, join(repoRoot, "packages", "server", "dist"), launch.needsExecutor ? "bridge" : undefined);

    let session: Awaited<ReturnType<typeof openMCPSession>> | undefined;
    try {
      const serverArgs = [
        "--engine", "isolated-vm",
        "--framework", launch.id,
        "--tier", config.tier ?? "S",
        "--host", "local",
        "--root", "/work",
        "--events", "/out/events.jsonl",
        "--transcript", "/out/transcript.jsonl",
        "--blobs", "/out/blobs",
        ...launch.executorArgs,
      ];
      const serverDescriptor = await startServer(ctr, serverArgs);
      session = await openMCPSession(serverDescriptor);

      const taskText = readTaskText(problemsDir, job.problem);
      const systemPrompt = buildSystemPrompt(session.instructions ?? "");

      const client = createChatClient({ baseURL, apiKey, timeoutMs: 300_000 });
      // Read turnLimit from task.json; turnLimits map allows overrides, fallback to 20.
      const taskJsonPath = join(problemsDir, job.problem, "task.json");
      const taskJson = existsSync(taskJsonPath)
        ? (JSON.parse(readFileSync(taskJsonPath, "utf8")) as { turnLimit?: number })
        : {};
      const turnLimit = turnLimits[job.problem] ?? taskJson.turnLimit ?? 20;

      modelLoopStarted = true;
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
      });

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
        const gradeResult = await gradeJob(ctr, problemDir, jobDir);
        if (gradeResult.pass) {
          outcome = "pass";
          reason = null;
        } else {
          reason = gradeResult.reason ?? "checks";
        }
      }
    } finally {
      if (session) {
        try { await closeMCPSession(session); }
        catch { costReasons.push("server-close-failed"); }
      }
      await removeContainer(ctr).catch(() => { costReasons.push("container-stop-failed"); });
    }
  } catch (e) {
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
