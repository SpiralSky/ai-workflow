#!/usr/bin/env node
// Logs branch session metrics to JSONL file (timestamp, task, branch_calls, cost).
// Called from Stop hook. Reads BRANCH_TRACE_DIR for the latest trace file.
// Writes to BRANCH_METRICS_LOG (default: ~/.local/share/branch-framework/branch-metrics.jsonl).
// Skips silently if BRANCH_METRICS_LOG is unset or trace file not found.
import { existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const metricsLog = process.env.BRANCH_METRICS_LOG ?? join(homedir(), ".local/share/branch-framework/branch-metrics.jsonl");

const traceDir = process.env.BRANCH_TRACE_DIR;
if (!traceDir || !existsSync(traceDir)) process.exit(0);  // No trace dir, skip

// Find the most recent trace file
const traces = readdirSync(traceDir)
  .filter(f => f.endsWith(".jsonl"))
  .map(f => ({ name: f, path: join(traceDir, f), mtime: new Date(readFileSync(join(traceDir, f), "utf8").split("\n")[0]?.match(/"t":"([^"]+)"/)?.[1] || 0) }))
  .sort((a, b) => b.mtime - a.mtime);

if (!traces.length) process.exit(0);  // No trace files

const tracePath = traces[0].path;
const traceLines = readFileSync(tracePath, "utf8").split("\n").filter(Boolean);

// Extract metrics
const timestamp = new Date().toISOString();
const task = process.env.BRANCH_TASK ?? "unknown";
let branchCalls = 0;
let totalCost = 0;

for (const line of traceLines) {
  try {
    const entry = JSON.parse(line);
    if (entry.type === "branch") branchCalls++;
    if (entry.type === "llm" && entry.costUsd != null) totalCost += entry.costUsd;
  } catch {
    // Skip malformed lines
  }
}

// Write JSONL entry
const logEntry = JSON.stringify({ timestamp, task, branch_calls: branchCalls, cost: totalCost > 0 ? totalCost.toFixed(4) : null });
mkdirSync(dirname(metricsLog), { recursive: true });
appendFileSync(metricsLog, logEntry + "\n");
