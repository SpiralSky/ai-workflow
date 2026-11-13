#!/usr/bin/env tsx
/**
 * CLI entry point for `aiw`: the AI Workflow evaluation runner.
 * Commands: eval, report, problems build/check, view.
 * Runner architecture §2.
 */

import { collectStaticProvenance } from "./provenance.ts";
import { parseArgs } from "node:util";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { resolveConfig, buildProvenance, expandModes, DEFAULT_CONCURRENCY } from "./config.ts";
import { buildPlan } from "./plan.ts";
import { createRunDir, generateRunId, writeRunJSON } from "./rundir.ts";
import { runScheduler } from "./scheduler.ts";
import { combineRuns } from "./combine.ts";
import { buildProblems, checkProblems } from "./problems/index.ts";
import { createTypeSafeDecisionsClient, createDeepSeekClient, createChatGPTAuth, createChatGPTClient, listChatGPTModels } from "@aiw/llm";
import { boundSubscriptionClient } from "./subscription.ts";
import { authCommand } from "./auth-cli.ts";

/** Repo root: find upward from this file. */
function repoRoot(): string {
  // Walk up from packages/runner/src to the project root
  const here = new URL("../../..", import.meta.url);
  return here.pathname.replace(/\/$/, "");
}

function usage(): void {
  process.stderr.write(`
Usage:
  aiw auth    signin [account-id] | accounts | models <account-id> | signout <account-id>

  aiw eval    --problems <ids|all|small|large|dev|smoke>
              --mode <baseline|branch-only|orchestrate|compare|variant,...>
              --tools S|L  [--reps 1]  [--model deepseek/deepseek-v4-flash]
              [--secondary-model <model>]  [--temperature 0]
              [--budget 0.50 (1.00 with --full)]  [--full]  [--concurrency 1]
              [--branch-context trace|annotated|full]
              [--secondary-cap 4] [--classifier-provider openrouter-decisions|typesafe] [--classifier-model <decision-model>] [--classifier-threshold <0.5..1>]
              [--provider openrouter|chatgpt|deepseek]
              [--account <saved-id>] [--max-calls N --max-tokens N --max-duration-ms N]  (ChatGPT plan runs)
              [--until-reps N]  [--combine-with <report>]

  aiw report  <run-dir>... --name <report-name>

  aiw problems build [<id>...]
  aiw problems check [<id>...]

  aiw view    [--watch]
`);
}

async function evalCommand(argv: string[]): Promise<void> {
  const { values, positionals: _ } = parseArgs({
    args: argv,
    options: {
      problems: { type: "string" },
      mode: { type: "string" },
      tools: { type: "string" },
      reps: { type: "string", default: "1" },
      model: { type: "string" },
      provider: { type: "string", default: "openrouter" },
      account: { type: "string" },
      "max-calls": { type: "string" },
      "max-tokens": { type: "string" },
      "max-duration-ms": { type: "string" },
      "secondary-model": { type: "string" },
      "classifier-provider": { type: "string" },
      "classifier-model": { type: "string" },
      "classifier-threshold": { type: "string" },
      temperature: { type: "string" },
      budget: { type: "string" },
      full: { type: "boolean", default: false },
      concurrency: { type: "string", default: String(DEFAULT_CONCURRENCY) },
      "branch-context": { type: "string", default: "trace" },
      "secondary-cap": { type: "string", default: "4" },
      "until-reps": { type: "string" },
      "combine-with": { type: "string" },
    },
    allowPositionals: true,
  });

  if (!values.problems) { usage(); process.exit(1); }
  if (!values.mode) { usage(); process.exit(1); }
  if (!values.tools || (values.tools !== "S" && values.tools !== "L")) {
    process.stderr.write("--tools must be S or L\n"); process.exit(1);
  }

  const useDeepSeek = values.provider === "deepseek";
  if (useDeepSeek && (!values.model || values.temperature !== undefined)) throw new Error("DeepSeek requires explicit --model deepseek-flash and no --temperature");
  const useChatGPT = values.provider === "chatgpt";
  if (useChatGPT && (!values.model || !values.account)) throw new Error("ChatGPT runs require explicit --account and --model; run aiw auth signin separately");
  if (useChatGPT && values.temperature !== undefined) throw new Error("ChatGPT plan runs do not accept --temperature");
  if (!useChatGPT && (values["max-calls"] || values["max-tokens"] || values["max-duration-ms"])) throw new Error("--max-calls/--max-tokens/--max-duration-ms are ChatGPT plan limits");
  if (!useChatGPT && values.account) throw new Error("--account is only for ChatGPT plan usage");
  const apiKey = useChatGPT ? "" : useDeepSeek ? process.env["DEEPSEEK_API_KEY"] ?? "" : process.env["OPENAI_API_KEY"] ?? process.env["OPENROUTER_API_KEY"] ?? "";
  const baseURL = useDeepSeek ? "https://api.deepseek.com" : useChatGPT ? "https://api.openai.com/v1" : process.env["OPENAI_BASE_URL"] ?? "https://openrouter.ai/api/v1";

  const root = repoRoot();
  const problemsDir = join(root, "experiments", "problems");

  // Load available problems by reading task.json from each problem directory.
  const { readdirSync, readFileSync } = await import("node:fs");
  let available: Array<{ id: string; size: string; set: string }> = [];
  if (existsSync(problemsDir)) {
    available = readdirSync(problemsDir)
      .filter((e) => !e.startsWith("."))
      .map((id) => {
        try {
          const raw = JSON.parse(readFileSync(join(problemsDir, id, "task.json"), "utf8")) as {
            size?: string; set?: string;
          };
          return { id, size: raw.size ?? "small", set: raw.set ?? "reported" };
        } catch {
          return { id, size: "small", set: "reported" };
        }
      });
  }

  const config = resolveConfig(
    {
      provider: values.provider as "openrouter" | "chatgpt" | "deepseek",
      ...((values["max-calls"] || values["max-tokens"] || values["max-duration-ms"]) ? { subscriptionLimits: {
        maxCalls: Number(values["max-calls"]), maxTokens: Number(values["max-tokens"]), maxDurationMs: Number(values["max-duration-ms"]),
      } } : {}),
      problems: values.problems!,
      mode: values.mode!,
      tools: values.tools as "S" | "L",
      reps: parseInt(values.reps ?? "1", 10),
      model: values.model ?? "deepseek/deepseek-v4-flash",
      secondaryModel: values["secondary-model"],
      classifierProvider: values["classifier-provider"] as "openrouter-decisions" | "typesafe" | undefined,
      classifierModel: values["classifier-model"],
      classifierThreshold: values["classifier-threshold"] !== undefined ? Number(values["classifier-threshold"]) : undefined,
      temperature: parseFloat(values.temperature ?? "0"),
      budget: Number(values.budget ?? (values.full ? "1.00" : "0.50")),
      full: values.full ?? false,
      concurrency: Number(values.concurrency ?? DEFAULT_CONCURRENCY),
      branchContext: (values["branch-context"] ?? "trace") as "trace" | "annotated" | "full",
      secondaryCap: parseInt(values["secondary-cap"] ?? "4", 10),
      untilReps: values["until-reps"] ? parseInt(values["until-reps"], 10) : undefined,
      combineWith: values["combine-with"],
    },
    available,
  );

  const plan = buildPlan(config, root);
  if (plan.projectedCostUsd !== undefined && plan.projectedCostUsd > config.budgetUsd) {
    process.stderr.write(
      `Projected cost $${plan.projectedCostUsd.toFixed(4)} exceeds budget $${config.budgetUsd}. Aborting.\n`,
    );
    process.exit(1);
  }

  const provenance = collectStaticProvenance(root, config, {
    ...buildProvenance(root),
    inference: { provider: config.provider!, mainModel: config.models.main, secondaryModel: config.models.secondary,
      temperature: useChatGPT || useDeepSeek ? null : config.temperature, ...(useChatGPT ? { stream: true as const, store: false as const } : {}) },
  });

  let subscription: ReturnType<typeof boundSubscriptionClient> | undefined;
  if (useChatGPT) {
    const auth = createChatGPTAuth();
    const accessToken = (signal?: AbortSignal) => auth.getAccessToken(values.account!, signal);
    // Discovery uses a saved explicit account only; failure never opens a browser or falls back.
    const models = await listChatGPTModels({ accessToken });
    for (const model of [config.models.main, config.models.secondary]) {
      if (!models.some((entry) => entry.slug === model)) throw new Error("Selected model is not available for this ChatGPT account; use aiw auth models");
    }
    subscription = boundSubscriptionClient(createChatGPTClient({ accessToken }), config.subscriptionLimits!);
  }

  // Host-only direct clients; the scheduler meters them against the one run budget.
  const llmClient = useDeepSeek ? createDeepSeekClient({ apiKey }) : undefined;
  const classifierClient = config.classifier?.provider === "typesafe"
    ? createTypeSafeDecisionsClient({ apiKey: process.env["TYPESAFE_API_KEY"] ?? "", model: config.classifier.model }) : undefined;

  const runId = generateRunId();

  const runDir = createRunDir(root, runId, config, provenance);
  console.log(`Run: ${runId} (${plan.jobs.length} jobs)`);

  const runJSON = {
    format: 1 as const,
    id: runId,
    status: "in-progress" as const,
    config,
    provenance,
    totals: { jobs: 0, attempts: 0, costUsd: 0, pass: 0, fail: 0 },
    startedAt: new Date().toISOString(),
  };

  const invalidReason = await runScheduler(
    {
      jobs: plan.jobs,
      config,
      runPath: runDir.path,
      repoRoot: root,
      apiKey,
      baseURL,
      subscription, llmClient, classifierClient,
      turnLimits: {}, // populated from provenance in full impl
      problemsDir,
      onJobDone: (job, result) => {
        console.log(`  ${result.outcome === "pass" ? "PASS" : "FAIL"} ${job.problem}.${job.framework}.${job.rep}`);
      },
    },
    runJSON as import("./types.ts").RunJSON,
  );

  const finalRunJSON: import("./types.ts").RunJSON = {
    ...runJSON,
    status: invalidReason ? { invalid: invalidReason } : "complete",
    totals: runJSON.totals,
    endedAt: new Date().toISOString(),
  };
  writeRunJSON(runDir.path, finalRunJSON);

  console.log(
    `\nRun ${finalRunJSON.status === "complete" ? "complete" : "invalid"}: ${runDir.path}`,
  );
}

async function reportCommand(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      name: { type: "string" },
    },
    allowPositionals: true,
  });
  if (!values.name) { process.stderr.write("--name is required\n"); process.exit(1); }
  if (positionals.length === 0) { process.stderr.write("At least one run directory required\n"); process.exit(1); }
  const root = repoRoot();
  await combineRuns(positionals, values.name, root);
}

async function problemsCommand(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  const root = repoRoot();
  const problemsDir = join(root, "experiments", "problems");
  if (sub === "build") {
    await buildProblems(rest, problemsDir);
  } else if (sub === "check") {
    await checkProblems(rest, problemsDir);
  } else {
    process.stderr.write(`Unknown problems subcommand: ${sub}\n`);
    usage();
    process.exit(1);
  }
}

async function viewCommand(argv: string[]): Promise<void> {
  const watch = argv.includes("--watch");
  const viewerPkg = new URL("../../viewer/", import.meta.url).pathname;
  const indexerDist = join(viewerPkg, "indexer", "dist", "index.js");
  const distHTML = join(viewerPkg, "dist", "index.html");

  if (!existsSync(indexerDist)) {
    console.error("[view] Indexer not built. Run: cd packages/viewer && npm run build:indexer");
    process.exit(1);
  }

  // Run the indexer (or start it in watch mode)
  const { spawn } = await import("node:child_process");
  const indexerArgs = watch ? ["--watch"] : [];
  if (watch) {
    // Start indexer in background watch mode
    const child = spawn(process.execPath, [indexerDist, ...indexerArgs], {
      stdio: "inherit",
      detached: false,
    });
    child.on("error", (err) => console.error("[view] indexer error:", err));
    console.log("[view] Indexer running in watch mode (Ctrl+C to stop).");
  } else {
    // Run indexer once synchronously
    const { execFileSync } = await import("node:child_process");
    execFileSync(process.execPath, [indexerDist], { stdio: "inherit" });
  }

  if (!existsSync(distHTML)) {
    console.error("[view] Viewer app not built. Run: cd packages/viewer && npm run build");
    process.exit(1);
  }

  // Serve dist/ over HTTP so the browser can load ES module scripts with crossorigin attributes.
  // Opening file:// directly blocks those scripts due to CORS enforcement on file origins.
  const http = await import("node:http");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const distDir = join(viewerPkg, "dist");

  const MIME: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
  };

  const server = http.default.createServer((req, res) => {
    const urlPath = req.url?.split("?")[0] ?? "/";
    const filePath = join(distDir, urlPath === "/" ? "index.html" : urlPath);
    const ext = path.default.extname(filePath);
    const contentType = MIME[ext] ?? "application/octet-stream";
    fs.default.readFile(filePath, (err, data) => {
      if (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          // SPA fallback: serve index.html for unknown paths
          fs.default.readFile(join(distDir, "index.html"), (e2, d2) => {
            if (e2) { res.writeHead(500); res.end(); return; }
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(d2);
          });
        } else {
          res.writeHead(500); res.end();
        }
        return;
      }
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  const addr = server.address() as { port: number };
  const url = `http://127.0.0.1:${addr.port}/`;

  const { platform } = process;
  const opener = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  const { spawn: spawnOpen } = await import("node:child_process");
  spawnOpen(opener, [url], { stdio: "ignore", detached: true }).unref();
  console.log(`[view] Serving viewer at ${url} (Ctrl+C to stop)`);
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "auth":
      await authCommand(rest);
      break;
    case "eval":
      await evalCommand(rest);
      break;
    case "report":
      await reportCommand(rest);
      break;
    case "problems":
      await problemsCommand(rest);
      break;
    case "view":
      await viewCommand(rest);
      break;
    default:
      usage();
      process.exit(command ? 1 : 0);
  }
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
