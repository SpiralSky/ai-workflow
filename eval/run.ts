// Usage (from framework/): npm run eval -- --problem 01 --mode baseline|branch|branch-only|both|all --n 3 --model sonnet [--report intent|none]
import { spawnSync, spawn, execFileSync } from "node:child_process";
import { cpSync, statSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, createWriteStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const FW = join(ROOT, "framework");
const PROBLEMS = join(ROOT, "loop-testbed", "problems");

export interface Metrics {
  turns: number; cost: number; durationMs: number;
  input: number; output: number; cacheRead: number; cacheCreate: number;
  branchCalls: number; returnUser: boolean; isError: boolean;
  subCost: number; msgChars: number;
}

// Parse a stream-json transcript (one JSON event per line).
export function parseStream(text: string): Metrics {
  const m: Metrics = { turns: 0, cost: 0, durationMs: 0, input: 0, output: 0, cacheRead: 0, cacheCreate: 0, branchCalls: 0, returnUser: false, isError: false, subCost: 0, msgChars: 0 };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    const content = ev?.message?.content;
    if (ev.type === "assistant" && Array.isArray(content)) {
      for (const c of content) if (c.type === "tool_use" && c.name === "mcp__branch__branch") m.branchCalls++;
    } else if (ev.type === "user" && Array.isArray(content)) {
      for (const c of content) if (c.type === "tool_result" && /<<RETURN_USER>>|Delivered to user\./.test(JSON.stringify(c.content ?? ""))) m.returnUser = true;
    } else if (ev.type === "result") {
      m.turns = ev.num_turns ?? 0; m.cost = ev.total_cost_usd ?? 0; m.durationMs = ev.duration_ms ?? 0; m.isError = !!ev.is_error;
      const u = ev.usage ?? {};
      m.input = u.input_tokens ?? 0; m.output = u.output_tokens ?? 0;
      m.cacheRead = u.cache_read_input_tokens ?? 0; m.cacheCreate = u.cache_creation_input_tokens ?? 0;
    }
  }
  return m;
}

// Sum sub-LLM cost (events type "llm", from llm()/check()/classify() helper calls) from branch trace files belonging to this run.
export function subCostFromTraces(files: { name: string; text: string }[]): number {
  let sum = 0;
  for (const f of files) for (const line of f.text.split("\n")) {
    if (!line.includes('"costUsd"')) continue;
    try { const ev = JSON.parse(line); if (ev.type === "llm" && typeof ev.costUsd === "number") sum += ev.costUsd; } catch { /* skip */ }
  }
  return sum;
}

// Final user-visible message: last "final" event from the branch traces (what returnUser delivered), else the stream's result text;
// plus the auto change report block (last "report" event, written by the Stop / returnUser hooks).
export function finalMessage(streamText: string, traces: { text: string }[]): string {
  let msg = "", report = "";
  for (const f of traces) for (const line of f.text.split("\n")) {
    if (!line.includes('"final"') && !line.includes('"report"')) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === "final" && typeof ev.text === "string") msg = ev.text;
      else if (ev.type === "report" && typeof ev.text === "string") report = ev.text;
    } catch { /* skip */ }
  }
  if (!msg) for (const line of streamText.split("\n")) { try { const ev = JSON.parse(line); if (ev.type === "result" && ev.result) msg = ev.result; } catch { /* skip */ } }
  return report ? `${msg}\n\n${report}` : msg;
}

// The prompt is only the blockquote under "## Prompt to give the AI"; the rest of PROBLEM.md is hidden notes.
export function extractPrompt(problemMd: string): string {
  const sec = problemMd.split(/^## Prompt to give the AI\s*$/m)[1]?.split(/^## /m)[0] ?? problemMd;
  const q = sec.split("\n").filter(l => l.startsWith(">")).map(l => l.replace(/^>\s?/, "")).join("\n").trim();
  return (q || sec.trim()).replace(/^`([^`]*)`$/, "$1");
}

function parseArgs(argv: string[]) {
  const a: Record<string, string> = { mode: "both", n: "1", model: "sonnet" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help" || argv[i] === "-h") a.help = "1";
    else if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[++i];
  }
  return a;
}

const HELP = `npm run eval -- --problem <id e.g. 01 | all> [--mode baseline|branch|branch-only|both|all] [--n 3] [--model sonnet]
Runs claude -p on a temp copy of loop-testbed/problems/<id>*, then python3 -m unittest.
Raw streams: eval/runs/<ts>/<problem>-<mode>-<i>.jsonl (BRANCH_TRACE_DIR = that dir too).`;

const fmt = (x: number, d = 0) => x.toFixed(d);
const COLS = ["run", "ok", "turns", "cost$", "dur_s", "in", "out", "cacheR", "cacheC", "branch", "retUser", "subCost$", "msgChars"];
const row = (name: string, ok: string, m: Metrics) =>
  [name, ok, m.turns, fmt(m.cost, 3), fmt(m.durationMs / 1000, 1), m.input, m.output, m.cacheRead, m.cacheCreate, m.branchCalls, m.returnUser ? "y" : "n", fmt(m.subCost, 3), fmt(m.msgChars)].join("\t");

// Same small built-in set in all modes; tool search off so mcp__branch__branch is loaded, not deferred.
const CODING_TOOLS = "Bash,Read,Edit,Write,Glob,Grep";
type Mode = "baseline" | "branch" | "branch-only";
async function runOne(problemDir: string, mode: Mode, model: string, runsDir: string, tag: string, report: string) {
  const work = mkdtempSync(join(tmpdir(), "eval-"));
  cpSync(problemDir, work, { recursive: true });
  const prompt = extractPrompt(readFileSync(join(problemDir, "PROBLEM.md"), "utf8"));
  for (const f of ["PROBLEM.md", "STEPS.md", "TRACE.md"]) rmSync(join(work, f), { force: true });
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--model", model,
    "--permission-mode", "bypassPermissions", "--setting-sources", "", "--strict-mcp-config", "--tools", mode === "branch-only" ? "" : CODING_TOOLS];
  const benv = { ...process.env, BRANCH_REPORT: report };
  if (mode !== "baseline" && (!existsSync(join(FW, "mcp.json")) || !existsSync(join(FW, "settings.json")))) execFileSync(join(FW, "setup.sh"), ["--gen-only"]);
  if (mode !== "baseline") args.push("--mcp-config", join(FW, "mcp.json"), "--settings", join(FW, "settings.json"),
    "--append-system-prompt-file", execFileSync(join(FW, "bin", "build-prompt"), { encoding: "utf8", env: benv }).trim());
  const out = join(runsDir, `${tag}.jsonl`);
  const seen = new Set(readdirSync(runsDir)); // trace files created during this run = new files besides the stream
  const ws = createWriteStream(out);
  await new Promise<void>(res => {
    const p = spawn("claude", args, { cwd: work, env: { ...benv, BRANCH_TRACE_DIR: runsDir, ENABLE_TOOL_SEARCH: "false" }, stdio: ["ignore", "pipe", "pipe"] });
    p.stdout.pipe(ws); p.stderr.resume(); p.on("close", () => res()); p.on("error", () => res());
  });
  const t = spawnSync("python3", ["-m", "unittest"], { cwd: work, encoding: "utf8" });
  rmSync(work, { recursive: true, force: true });
  const stream = readFileSync(out, "utf8");
  const traces = readdirSync(runsDir).filter(f => !seen.has(f) && f !== `${tag}.jsonl` && f.endsWith(".jsonl"))
    .map(name => ({ name, text: readFileSync(join(runsDir, name), "utf8") }));
  const m = parseStream(stream);
  m.subCost = subCostFromTraces(traces);
  const msg = finalMessage(stream, traces);
  m.msgChars = msg.length;
  writeFileSync(join(runsDir, `${tag}.final.txt`), msg + "\n");
  return { m, pass: t.status === 0 };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || !a.problem) { console.log(HELP); return; }
  const report = a.report ?? "intent";
  if (!["intent", "none"].includes(report)) throw new Error(`bad --report ${report}`);
  const dirs = a.problem === "all" ? readdirSync(PROBLEMS).filter(d => statSync(join(PROBLEMS, d)).isDirectory()).sort()
    : [readdirSync(PROBLEMS).find(d => d.startsWith(a.problem))].filter((d): d is string => !!d);
  if (!dirs.length) throw new Error(`no problem ${a.problem}`);
  const modes = a.mode === "both" ? ["baseline", "branch"] as Mode[] : a.mode === "all" ? ["baseline", "branch", "branch-only"] as Mode[] : [a.mode as Mode];
  const runsDir = join(HERE, "runs", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(runsDir, { recursive: true });
  console.log(COLS.join("\t"));
  const all: Record<string, { m: Metrics; pass: boolean }[]> = {};
  for (const dir of dirs) { const id = dir.split(/[-_]/)[0];
    for (const mode of modes) for (let i = 1; i <= Number(a.n); i++) {
      const r = await runOne(join(PROBLEMS, dir), mode, a.model, runsDir, `${id}-${mode}-${i}`, report);
      (all[mode] ??= []).push(r);
      console.log(row(`${id}-${mode}-${i}`, r.pass ? "pass" : "FAIL", r.m));
    }
  }
  for (const [mode, rs] of Object.entries(all)) {
    const mean = (f: (m: Metrics) => number) => rs.reduce((s, r) => s + f(r.m), 0) / rs.length;
    const mm: Metrics = { turns: mean(m => m.turns), cost: mean(m => m.cost), durationMs: mean(m => m.durationMs), input: mean(m => m.input),
      output: mean(m => m.output), cacheRead: mean(m => m.cacheRead), cacheCreate: mean(m => m.cacheCreate), branchCalls: mean(m => m.branchCalls),
      returnUser: false, isError: false, subCost: mean(m => m.subCost), msgChars: mean(m => m.msgChars) };
    const line = row(`MEAN ${mode}`, `${rs.filter(r => r.pass).length}/${rs.length}`, mm).split("\t");
    line[10] = `${rs.filter(r => r.m.returnUser).length}/${rs.length}`;
    console.log(line.join("\t"));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
