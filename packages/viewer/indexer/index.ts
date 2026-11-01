#!/usr/bin/env node
/**
 * Viewer indexer CLI.
 * Reads experiments/runs/ and writes dist/data/index.js and per-job data files.
 *
 * Usage:
 *   node indexer/dist/index.js [--runs-dir <path>] [--out-dir <path>] [--watch]
 */

import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default paths relative to package root (two levels up from indexer/dist/)
const PKG_ROOT = resolve(__dirname, "..", "..");
const DEFAULT_RUNS_DIR = resolve(PKG_ROOT, "..", "..", "experiments", "runs");
const DEFAULT_OUT_DIR = resolve(PKG_ROOT, "dist", "data");

/** Parse CLI arguments. */
function parseArgs(): { runsDir: string; outDir: string; watch: boolean } {
  const argv = process.argv.slice(2);
  let runsDir = DEFAULT_RUNS_DIR;
  let outDir = DEFAULT_OUT_DIR;
  let watch = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--runs-dir" && argv[i + 1]) {
      runsDir = resolve(argv[++i]!);
    } else if (argv[i] === "--out-dir" && argv[i + 1]) {
      outDir = resolve(argv[++i]!);
    } else if (argv[i] === "--watch") {
      watch = true;
    }
  }

  return { runsDir, outDir, watch };
}

/** Parse a JSONL file into an array of objects, skipping invalid lines. */
function parseJSONL(path: string): unknown[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter((v): v is unknown => v !== null);
}

/** Read a text file, returning empty string if missing. */
function readText(path: string): string {
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Emit a window.__aiw.register() script file. */
function writeScript(path: string, key: string, data: unknown): void {
  const json = JSON.stringify(data);
  // Escape </script> so inline embedding in HTML stays safe
  const safe = json.replace(/<\/script>/gi, "<\\/script>");
  const content = `window.__aiw.register(${JSON.stringify(key)}, ${safe});\n`;
  writeFileSync(path, content, "utf8");
}

interface RunJSON {
  format: number;
  id: string;
  status: unknown;
  config: {
    problems: string[];
    frameworks: string[];
    models: { main: string; secondary?: string };
    [key: string]: unknown;
  };
  totals: { jobs: number; pass: number; fail: number; costUsd: number | null; attempts: number };
  startedAt: string;
  endedAt?: string;
  provenance: Record<string, unknown>;
}

interface JobJSON {
  format: number;
  problem: string;
  framework: string;
  rep: number;
  outcome: "pass" | "fail";
  reason: string | null;
  attempts: Array<{ n: number; final?: boolean; infraError?: string; costUsd?: number | null }>;
  costUsdAllAttempts: number | null;
  durationMs: number;
}

interface RawEvent {
  v: number;
  id: string;
  parent: string | null;
  ts: number;
  kind: string;
  [key: string]: unknown;
}

/** Derive a JobSummary from events if job.json is missing. */
function deriveJobFromEvents(
  jobDir: string,
  jobName: string
): Omit<JobJSON, "format"> | null {
  const parts = jobName.split(".");
  // name format: <problem>.<framework>.<rep>
  // problem may contain dots, framework and rep are last two segments
  if (parts.length < 3) return null;
  const rep = parseInt(parts[parts.length - 1]!, 10);
  const framework = parts[parts.length - 2]!;
  const problem = parts.slice(0, -2).join(".");

  const events = parseJSONL(join(jobDir, "events.jsonl")) as RawEvent[];
  const endEvent = events.find((e) => e.kind === "end" || e.kind === "done");
  const outcome = (endEvent?.outcome as string) === "pass" ? "pass" : "fail";
  const reason = (endEvent?.reason as string) ?? null;

  // A partial log without job.json cannot establish complete billed cost.
  const costUsd = null;

  // Duration: last ts - first ts
  const timestamps = events.map((e) => e.ts).filter((t) => typeof t === "number") as number[];
  const durationMs =
    timestamps.length >= 2
      ? (timestamps[timestamps.length - 1]! - timestamps[0]!)
      : 0;

  return {
    problem,
    framework,
    rep: isNaN(rep) ? 0 : rep,
    outcome,
    reason,
    attempts: [{ n: 0, final: true }],
    costUsdAllAttempts: costUsd,
    durationMs,
  };
}

/** Process one run directory, writing index entry and per-job files. */
function processRun(
  runsDir: string,
  runDirName: string,
  outDir: string
): {
  id: string;
  status: unknown;
  startedAt: string;
  endedAt: string | null;
  frameworks: string[];
  problems: string[];
  models: { main: string; secondary?: string };
  totals: { jobs: number; pass: number; fail: number; costUsd: number | null; attempts: number };
  provenance: Record<string, unknown>;
  jobs: Array<{
    name: string;
    problem: string;
    framework: string;
    rep: number;
    outcome: "pass" | "fail";
    reason: string | null;
    costUsdAllAttempts: number | null;
    durationMs: number;
    attempts: number;
  }>;
} | null {
  const runDir = join(runsDir, runDirName);
  const runJSONPath = join(runDir, "run.json");
  if (!existsSync(runJSONPath)) return null;

  let run: RunJSON;
  try {
    run = JSON.parse(readFileSync(runJSONPath, "utf8")) as RunJSON;
  } catch {
    console.warn(`[indexer] Skipping ${runDirName}: invalid run.json`);
    return null;
  }
  if (run.format !== 1) {
    console.warn(`[indexer] Skipping ${runDirName}: unknown format ${run.format}`);
    return null;
  }

  const jobOutDir = join(outDir, "jobs", run.id);
  mkdirSync(jobOutDir, { recursive: true });

  // Enumerate job directories
  const entries = readdirSync(runDir, { withFileTypes: true });
  const jobDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const jobs: Array<{
    name: string;
    problem: string;
    framework: string;
    rep: number;
    outcome: "pass" | "fail";
    reason: string | null;
    costUsdAllAttempts: number | null;
    durationMs: number;
    attempts: number;
  }> = [];

  for (const jobDirName of jobDirs) {
    const jobDir = join(runDir, jobDirName);
    const jobJSONPath = join(jobDir, "job.json");

    let jobMeta: Omit<JobJSON, "format"> | null = null;
    if (existsSync(jobJSONPath)) {
      try {
        const raw = JSON.parse(readFileSync(jobJSONPath, "utf8")) as JobJSON;
        if (raw.format === 1) jobMeta = raw;
      } catch {
        // fall through to derivation
      }
    }
    if (!jobMeta) {
      jobMeta = deriveJobFromEvents(jobDir, jobDirName);
    }
    if (!jobMeta) {
      console.warn(`[indexer] Skipping job ${jobDirName}: cannot determine metadata`);
      continue;
    }

    // Write per-job data file
    const events = parseJSONL(join(jobDir, "events.jsonl")) as RawEvent[];
    const diff = readText(join(jobDir, "diff.patch"));
    const checkLog = readText(join(jobDir, "check.log"));

    const jobData = {
      runId: run.id,
      jobName: jobDirName,
      problem: jobMeta.problem,
      framework: jobMeta.framework,
      rep: jobMeta.rep,
      outcome: jobMeta.outcome,
      reason: jobMeta.reason,
      costUsdAllAttempts: jobMeta.costUsdAllAttempts,
      durationMs: jobMeta.durationMs,
      attempts: jobMeta.attempts,
      events,
      diff,
      checkLog,
    };

    const jobKey = `job:${run.id}/${jobDirName}`;
    writeScript(join(jobOutDir, `${jobDirName}.js`), jobKey, jobData);

    jobs.push({
      name: jobDirName,
      problem: jobMeta.problem,
      framework: jobMeta.framework,
      rep: jobMeta.rep,
      outcome: jobMeta.outcome,
      reason: jobMeta.reason,
      costUsdAllAttempts: jobMeta.costUsdAllAttempts,
      durationMs: jobMeta.durationMs,
      attempts: jobMeta.attempts.length,
    });
  }

  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt ?? null,
    frameworks: run.config.frameworks,
    problems: run.config.problems,
    models: run.config.models,
    totals: run.totals,
    provenance: run.provenance,
    jobs,
  };
}

/** Build the index from all runs and write data files. */
function buildIndex(runsDir: string, outDir: string): void {
  if (!existsSync(runsDir)) {
    console.warn(`[indexer] Runs directory not found: ${runsDir}`);
    mkdirSync(outDir, { recursive: true });
    writeScript(join(outDir, "index.js"), "index", { generated: new Date().toISOString(), runs: [] });
    return;
  }

  mkdirSync(outDir, { recursive: true });

  const runDirs = readdirSync(runsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const runs: ReturnType<typeof processRun>[] = [];
  for (const runDir of runDirs) {
    const entry = processRun(runsDir, runDir, outDir);
    if (entry) runs.push(entry);
  }

  const index = {
    generated: new Date().toISOString(),
    runs: runs.filter((r): r is NonNullable<typeof r> => r !== null),
  };

  writeScript(join(outDir, "index.js"), "index", index);
  console.log(`[indexer] indexed ${runs.length} run(s) → ${outDir}`);
}

/** Get the mtime of all run.json files for watch mode change detection. */
function latestRunMtime(runsDir: string): number {
  if (!existsSync(runsDir)) return 0;
  let latest = 0;
  try {
    for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const p = join(runsDir, entry.name, "run.json");
      try {
        const mt = statSync(p).mtimeMs;
        if (mt > latest) latest = mt;
      } catch {
        // ignore missing
      }
      // Also check events.jsonl mtimes for in-progress runs
      try {
        const jobEntries = readdirSync(join(runsDir, entry.name), { withFileTypes: true });
        for (const je of jobEntries) {
          if (!je.isDirectory()) continue;
          const ep = join(runsDir, entry.name, je.name, "events.jsonl");
          try {
            const mt = statSync(ep).mtimeMs;
            if (mt > latest) latest = mt;
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return latest;
}

const { runsDir, outDir, watch } = parseArgs();

buildIndex(runsDir, outDir);

if (watch) {
  console.log(`[indexer] watching ${runsDir} every 2s…`);
  let lastMtime = latestRunMtime(runsDir);
  setInterval(() => {
    const mtime = latestRunMtime(runsDir);
    if (mtime > lastMtime) {
      lastMtime = mtime;
      console.log(`[indexer] change detected, rebuilding…`);
      try {
        buildIndex(runsDir, outDir);
      } catch (err) {
        console.error("[indexer] build error:", err);
      }
    }
  }, 2000);
}
