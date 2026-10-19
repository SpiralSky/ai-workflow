// Usage (from framework/): npm run eval -- --problem 01 --mode baseline|branch-only|orchestrate|compare|all --n 3 --model sonnet [--backend openai]
import { spawnSync, execFileSync } from "node:child_process";
import { cpSync, statSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, createWriteStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const FW = join(ROOT, "framework");
const PROBLEMS = join(HERE, "problems");

export interface Metrics {
  turns: number; cost: number; durationMs: number;
  input: number; output: number; cacheRead: number; cacheCreate: number;
  branchCalls: number; delegateCalls: number; returnUser: boolean; isError: boolean;
  subCost: number; msgChars: number; orchestrateTurns: number;
  secondaryInputTok: number; secondaryOutputTok: number;
}

// Parse a stream-json transcript (one JSON event per line).
export function parseStream(text: string): Metrics {
  const m: Metrics = { turns: 0, cost: 0, durationMs: 0, input: 0, output: 0, cacheRead: 0, cacheCreate: 0, branchCalls: 0, delegateCalls: 0, returnUser: false, isError: false, subCost: 0, msgChars: 0, orchestrateTurns: 0, secondaryInputTok: 0, secondaryOutputTok: 0 };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    const content = ev?.message?.content;
    if (ev.type === "assistant" && Array.isArray(content)) {
      for (const c of content) { if (c.type === "tool_use" && c.name === "mcp__branch__branch") m.branchCalls++; if (c.type === "tool_use" && c.name === "mcp__branch__delegate") m.delegateCalls++; }
    } else if (ev.type === "user" && Array.isArray(content)) {
      for (const c of content) if (c.type === "tool_result" && /<<RETURN_USER>>/.test(JSON.stringify(c.content ?? ""))) m.returnUser = true;
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

// Sum secondary-LLM input/output tokens from trace files.
export function secondaryTokensFromTraces(files: { name: string; text: string }[]): { input: number; output: number } {
  let input = 0, output = 0;
  for (const f of files) for (const line of f.text.split("\n")) {
    if (!line.includes('"usage"')) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === "llm" && ev.usage) {
        input += ev.usage.prompt_tokens ?? 0;
        output += ev.usage.completion_tokens ?? 0;
      }
    } catch { /* skip */ }
  }
  return { input, output };
}

// Count inner-loop branch executions from trace files (only meaningful for orchestrate mode).
export function orchestrateTurnsFromTraces(files: { name: string; text: string }[], mode: Mode): number {
  if (mode !== "orchestrate") return 0;
  let count = 0;
  for (const f of files) for (const line of f.text.split("\n")) {
    if (!line.includes('"branch"')) continue;
    try { const ev = JSON.parse(line); if (ev.type === "branch") count++; } catch { /* skip */ }
  }
  return count;
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
  const sec = problemMd.split(/^## Prompt to give the AI\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  const q = sec.split("\n").filter(l => l.startsWith(">")).map(l => l.replace(/^>\s?/, "")).join("\n").trim();
  if (!q) throw new Error('PROBLEM.md: no "> ..." prompt under "## Prompt to give the AI" (refusing to leak hidden notes)');
  return q.replace(/^`([^`]*)`$/, "$1");
}

function parseArgs(argv: string[]) {
  const a: Record<string, string> = { mode: "compare", n: "3", model: "sonnet", concurrency: "5" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help" || argv[i] === "-h") a.help = "1";
    else if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[i + 1] === undefined || argv[i + 1].startsWith("--") ? "1" : argv[++i];
  }
  return a;
}

const HELP = `npm run eval -- --problem <id e.g. 01 | all | 02,06,07> [--mode baseline|branch-only|orchestrate|compare|all] [--n 3] [--model sonnet] [--backend openai]
             --retry-failed <run-dir>   re-run only failed jobs from a prior run dir (by timestamp name)
Runs the model on a temp copy of experiments/problems/<id>* (without hidden/), then copies hidden/test_hidden.py in and runs python3 -m unittest.
Modes: baseline=direct tools only, branch-only=branch tool only, orchestrate=delegate tool (task->BM25->sub-LLM).
--mode compare (default): baseline + branch-only + orchestrate side-by-side.
--mode both: baseline + branch-only.
--mode all: baseline + branch-only + orchestrate.
--turns <n>           max main-loop turns per job (default 40).
--orch-turns <n>      max secondary-LLM turns per delegate call (default 15; sets BRANCH_ORCHESTRATE_MAX_TURNS).
--timeout <s> per run (default 900). Pass = all tests incl. hidden pass and the run did not time out / error.
--concurrency <n> max parallel jobs (default 5). 429s retry up to 3× with exponential backoff (5s/10s/20s).
--selfcheck: no model; checks every problem's tests FAIL on the unmodified code.
Raw streams: experiments/runs/<ts>/<problem>-<mode>-<i>.jsonl (BRANCH_TRACE_DIR = that dir too).
total\$ = main cost + sub-LLM cost (llm()/check()/classify() calls inside branches).
--backend openai (default): calls OpenAI chat-completions API (set OPENAI_BASE_URL and OPENAI_API_KEY).
  Costs require OPENAI_MODEL_RATE_IN and OPENAI_MODEL_RATE_OUT (USD/Mtok).
  Sub-LLM calls inside orchestrate use ANTHROPIC_BASE_URL/ANTHROPIC_API_KEY (set alongside OPENAI_* vars).
  compare mode: baseline (control) + branch-only + orchestrate.`;

const fmt = (x: number, d = 0) => x.toFixed(d);
const COLS = ["run", "ok", "status", "turns", "total\$", "cost\$", "dur_s", "in", "out", "cacheR", "cacheC", "branch", "delegate", "orchTurns", "retUser", "subCost\$", "msgChars"];
const row = (name: string, ok: string, status: string, m: Metrics) =>
  [name, ok, status, m.turns, fmt(m.cost + m.subCost, 3), fmt(m.cost, 3), fmt(m.durationMs / 1000, 1), m.input, m.output, m.cacheRead, m.cacheCreate, m.branchCalls, m.delegateCalls, m.orchestrateTurns, m.returnUser ? "y" : "n", fmt(m.subCost, 3), fmt(m.msgChars)].join("\t");

// Same small built-in set in baseline mode; tool search off so mcp__branch__branch is loaded, not deferred.
const CODING_TOOLS = "Bash,Read,Edit,Write,Glob,Grep";
// Experimental roles:
//   baseline    — control: no branch tool, direct file tools (Bash/Read/Edit/...)
//   branch-only — primary isolation test: branch tool only; model uses tool() inside branch for file ops
//   orchestrate — two-tier: main model sends task descriptions -> BM25 shortlist -> secondary LLM branch loop
type Mode = "baseline" | "branch-only" | "orchestrate";
type Backend = "openai";

// Temp copy of a problem without the hidden notes / acceptance tests.
function workCopy(problemDir: string) {
  const work = mkdtempSync(join(tmpdir(), "eval-"));
  cpSync(problemDir, work, { recursive: true, filter: src => !src.includes("__pycache__") });
  for (const f of ["PROBLEM.md", "STEPS.md", "TRACE.md", "hidden"]) rmSync(join(work, f), { recursive: true, force: true });
  return work;
}

// Copy hidden acceptance tests over whatever the AI left (it may have edited/deleted visible tests), then run all tests.
function grade(problemDir: string, work: string) {
  const hidden = join(problemDir, "hidden");
  if (existsSync(hidden)) cpSync(hidden, work, { recursive: true });
  return spawnSync("python3", ["-m", "unittest"], { cwd: work, encoding: "utf8", timeout: 120_000 });
}


async function runOneWithOpenAIBackend(problemDir: string, mode: Mode, model: string, runsDir: string, tag: string, report: string, timeoutS: number, turnCap: number): Promise<{ m: Metrics; pass: boolean; status: string; failReason?: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set (required for --backend openai)");
  const openaiBase = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const prompt = extractPrompt(readFileSync(join(problemDir, "PROBLEM.md"), "utf8"));
  const work = workCopy(problemDir);
  const out = join(runsDir, `${tag}.jsonl`);
  const ws = createWriteStream(out);
  const errFile = join(runsDir, `${tag}.stderr`);
  const es = createWriteStream(errFile);

  writeFileSync(join(runsDir, `${tag}.meta.json`), JSON.stringify({ model, backend: "openai", mode, prompt }));

  // Build system prompt via build-prompt for non-baseline modes.
  let systemContent = "You are an expert software engineer. Fix the code problem described. Use the tools to read files, make changes, and run tests. When you are done, briefly say what you changed.";
  const traceFile = join(runsDir, `${tag}-branch.jsonl`);
  if (mode !== "baseline") {
    const branchMode = mode === "orchestrate" ? "orchestrate" : "branch";
    const benv = { ...process.env, BRANCH_REPORT: report, BRANCH_MODE: branchMode, BRANCH_SYSTEM: branchMode };
    try {
      const promptFile = execFileSync(join(FW, "bin", "build-prompt"), { encoding: "utf8", env: benv }).trim();
      systemContent = readFileSync(promptFile, "utf8");
      writeFileSync(join(runsDir, `${tag}.prompt.txt`), systemContent);
    } catch (e: any) { es.write(`build-prompt failed: ${e.message}\n`); }
  }

  // Tool definitions differ per mode.
  let tools: any[];
  if (mode === "baseline") {
    tools = [
      { type: "function", function: { name: "bash", description: "Run a shell command in the work directory. Returns stdout+stderr, capped at 10KB.", parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] } } },
      { type: "function", function: { name: "read_file", description: "Read a file (path relative to work dir)", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
      { type: "function", function: { name: "write_file", description: "Write or overwrite a file (path relative to work dir)", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
      { type: "function", function: { name: "edit_file", description: "Replace old_str with new_str in a file. old_str must occur exactly once.", parameters: { type: "object", properties: { path: { type: "string" }, old_str: { type: "string" }, new_str: { type: "string" } }, required: ["path", "old_str", "new_str"] } } },
      { type: "function", function: { name: "glob", description: "Find files matching a glob pattern relative to work dir.", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } } },
      { type: "function", function: { name: "grep", description: "Search for a pattern in files. Returns matching lines.", parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } }, required: ["pattern"] } } },
    ];
  } else if (mode === "branch-only") {
    tools = [
      { type: "function", function: { name: "branch", description: "Run a short async TS program that calls helper functions (bash, readFile, edit, runTests, returnUser, ...). Only the return value + a path summary come back. Full helper API: see system prompt.", parameters: { type: "object", properties: { intent: { type: "string", description: "What this program does, <=12 words" }, code: { type: "string", description: "Async TS program body" } }, required: ["intent", "code"] } } },
    ];
  } else {
    tools = [
      { type: "function", function: { name: "delegate", description: "Delegate a coding task to the execution layer. Returns a report of what was accomplished. Full spec: see system prompt.", parameters: { type: "object", properties: { task: { type: "string" }, policy: { type: "string" } }, required: ["task"] } } },
    ];
  }

  const session = { cwd: work, handles: new Map<string, string>(), state: {} as Record<string, unknown>, traceFile };
  // For orchestrate mode, prepend a file listing so the main LLM knows what files exist.
  let userContent = prompt;
  if (mode === "orchestrate") {
    const fl = spawnSync("bash", ["-c", "find . -not -path '*/__pycache__/*' -not -path '*/.git/*' -not -name '*.pyc' | sort | head -50"], { cwd: work, encoding: "utf8" });
    if (fl.stdout.trim()) userContent = `Project files:\n${fl.stdout.trim()}\n\n${prompt}`;
  }
  const messages: any[] = [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
  const m: Metrics = { turns: 0, cost: 0, durationMs: 0, input: 0, output: 0, cacheRead: 0, cacheCreate: 0,
    branchCalls: 0, delegateCalls: 0, returnUser: false, isError: false, subCost: 0, msgChars: 0, orchestrateTurns: 0,
    secondaryInputTok: 0, secondaryOutputTok: 0 };
  const t0 = Date.now();
  let statusStr = "ok";
  let anyEdit = false;
  let finalMsg = "";
  const deadline = t0 + timeoutS * 1000;
  const rateIn = parseFloat(process.env.OPENAI_MODEL_RATE_IN ?? "0");
  const rateOut = parseFloat(process.env.OPENAI_MODEL_RATE_OUT ?? "0");

  try {
    while (m.turns < turnCap && Date.now() < deadline && statusStr === "ok") {
      let resp: Response | undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          resp = await fetch(`${openaiBase}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            signal: AbortSignal.timeout(120_000),
            body: JSON.stringify({ model, messages, tools, tool_choice: "auto", max_tokens: 4096 }),
          });
        } catch (e: any) { statusStr = "fetch-error"; es.write(`fetch: ${e.message}\n`); break; }
        if (resp.status !== 429 || attempt >= 3) break;
        const delay = (2 ** attempt) * 5_000;
        es.write(`429 rate-limited; retrying in ${delay / 1000}s (attempt ${attempt + 1}/3)\n`);
        await new Promise(r => setTimeout(r, delay));
      }
      if (statusStr !== "ok") break;
      if (!resp!.ok) { statusStr = `api-${resp!.status}`; es.write(await resp!.text()); break; }
      const data: any = await resp!.json();
      m.turns++;
      const usage = data.usage ?? {};
      m.input += usage.prompt_tokens ?? 0;
      m.output += usage.completion_tokens ?? 0;
      m.cost += (rateIn * (usage.prompt_tokens ?? 0) + rateOut * (usage.completion_tokens ?? 0)) / 1_000_000;
      ws.write(JSON.stringify({ type: "turn", turn: m.turns, usage }) + "\n");

      const choice = data.choices?.[0];
      if (!choice) { statusStr = "no-choice"; break; }
      messages.push(choice.message);
      ws.write(JSON.stringify({ type: "assistant_message", message: choice.message }) + "\n");

      // DeepSeek v3 sometimes emits tool calls as native tokens in content instead of tool_calls.
      // Two known formats:
      //   Format 1: %@toolname\n```json\n{args}\n```
      //   Format 2: [](tool)[](tool)...\n```json\n{"name":"tool","arguments":{args}}\n```
      if (!choice.message.tool_calls?.length && typeof choice.message.content === "string") {
        const content = choice.message.content;
        const synthetic: any[] = [];
        let m2: RegExpExecArray | null;
        // Format 1: %@toolname
        const re1 = /%@(\w+)\s*```(?:json)?\s*([\s\S]*?)```/g;
        while ((m2 = re1.exec(content)) !== null) {
          try { synthetic.push({ id: `syn_${Date.now()}_${synthetic.length}`, type: "function", function: { name: m2[1], arguments: JSON.stringify(JSON.parse(m2[2].trim())) } }); } catch {}
        }
        // Format 2: [](tool)... then ```json{"name":"tool","arguments":{...}}```
        if (!synthetic.length) {
          const re2 = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/g;
          while ((m2 = re2.exec(content)) !== null) {
            try {
              const obj = JSON.parse(m2[1].trim());
              if (obj.name && obj.arguments && typeof obj.arguments === "object") {
                synthetic.push({ id: `syn_${Date.now()}_${synthetic.length}`, type: "function", function: { name: obj.name, arguments: JSON.stringify(obj.arguments) } });
              }
            } catch {}
          }
        }
        // Format 3: DeepSeek native special tokens
        // <｜tool▁call▁begin｜>function<｜tool▁sep｜>toolname\n```json\n{args}\n```
        if (!synthetic.length) {
          const re3 = /<｜tool[\s\S]{0,100}?sep｜>([\w]+)\s*```(?:json)?\s*([\s\S]*?)```/g;
          let m3: RegExpExecArray | null;
          while ((m3 = re3.exec(content)) !== null) {
            try {
              synthetic.push({ id: `syn_${Date.now()}_${synthetic.length}`, type: "function",
                function: { name: m3[1], arguments: JSON.stringify(JSON.parse(m3[2].trim())) } });
            } catch {}
          }
        }
        if (synthetic.length) {
          choice.message.tool_calls = synthetic;
          choice.message.content = null;
        }
      }
      if (!choice.message.tool_calls?.length) {
        finalMsg = choice.message.content ?? "";
        break;
      }

      const toolResults: any[] = [];
      for (const tc of choice.message.tool_calls) {
        let result = "";
        try {
          const fnArgs = JSON.parse(tc.function.arguments);
          if (tc.function.name === "bash") {
            const r = spawnSync("bash", ["-c", fnArgs.cmd as string], { cwd: work, encoding: "utf8", timeout: 30_000 });
            result = ((r.stdout ?? "") + (r.stderr ?? "")).slice(0, 10_000);
          } else if (tc.function.name === "read_file") {
            result = readFileSync(resolve(work, fnArgs.path as string), "utf8");
          } else if (tc.function.name === "write_file") {
            writeFileSync(resolve(work, fnArgs.path as string), fnArgs.content as string);
            anyEdit = true; result = "ok";
          } else if (tc.function.name === "edit_file") {
            const src = readFileSync(resolve(work, fnArgs.path as string), "utf8");
            const cnt = src.split(fnArgs.old_str as string).length - 1;
            if (cnt !== 1) { result = `Error: old_str ${cnt === 0 ? "not found" : "occurs " + cnt + " times"}`; }
            else { writeFileSync(resolve(work, fnArgs.path as string), src.replace(fnArgs.old_str as string, fnArgs.new_str as string)); anyEdit = true; result = "ok"; }
          } else if (tc.function.name === "glob") {
            const r = spawnSync("bash", ["-c", `find . -path "${(fnArgs.pattern as string).replace(/"/g, '\\"')}" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/__pycache__/*" 2>/dev/null | head -100`], { cwd: work, encoding: "utf8" });
            result = r.stdout.trim();
          } else if (tc.function.name === "grep") {
            const searchPath = fnArgs.path ? fnArgs.path as string : ".";
            const r = spawnSync("bash", ["-c", `grep -rn "${(fnArgs.pattern as string).replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null | head -50`], { cwd: work, encoding: "utf8" });
            result = r.stdout.trim() || "(no matches)";
          } else if (tc.function.name === "branch") {
            m.branchCalls++;
            const tsFile = join(work, ".branch-ts");
            writeFileSync(tsFile, "");
            const { runBranch } = await import("../framework/src/runner.js");
            const r = await runBranch(fnArgs.code as string, session, undefined, fnArgs.intent as string);
            if (!anyEdit) {
              const changed = spawnSync("bash", ["-c", "find . -newer .branch-ts -type f -not -path '*/__pycache__/*' -not -name '*.pyc' -not -name '.branch-ts' | head -1"], { cwd: work, encoding: "utf8" }).stdout.trim();
              if (changed) anyEdit = true;
            }
            if (r.kind === "user") {
              m.returnUser = true;
              finalMsg = r.text;
              result = `<<RETURN_USER>>\n${r.text}\n${r.path}`;
            } else if (r.kind === "error") {
              result = `ERROR: ${r.text}\n${r.path}`;
            } else {
              result = `${r.text}\n${r.path}\n(Returned)`;
            }
          } else if (tc.function.name === "delegate") {
            m.delegateCalls++;
            const tsFile2 = join(work, ".delegate-ts");
            writeFileSync(tsFile2, "");
            const { handleDelegate } = await import("../framework/src/delegate.js");
            result = await handleDelegate(fnArgs.task as string, fnArgs.policy as string | undefined, session as any);
            if (!anyEdit) {
              const changed2 = spawnSync("bash", ["-c", "find . -newer .delegate-ts -type f -not -path '*/__pycache__/*' -not -name '*.pyc' -not -name '.delegate-ts' | head -1"], { cwd: work, encoding: "utf8" }).stdout.trim();
              if (changed2) anyEdit = true;
            }
          }
        } catch (e: any) { result = `Error: ${e.message}`; }
        toolResults.push({ tool_call_id: tc.id, role: "tool" as const, content: result });
        ws.write(JSON.stringify({ type: "tool_result", tool_call_id: tc.id, name: tc.function.name, result: result.slice(0, 500) }) + "\n");
      }
      messages.push(...toolResults);
      if (m.returnUser) break;
    }
    if (Date.now() >= deadline && statusStr === "ok") statusStr = "timeout";
  } catch (e: any) { statusStr = "error"; es.write(`${(e as Error).message}\n`); m.isError = true; }

  m.durationMs = Date.now() - t0;
  m.msgChars = finalMsg.length;
  ws.write(JSON.stringify({ type: "result", result: finalMsg, num_turns: m.turns, duration_ms: m.durationMs,
    usage: { input_tokens: m.input, output_tokens: m.output },
    total_cost_usd: m.cost, is_error: m.isError }) + "\n");
  await Promise.all([new Promise(r => ws.end(r)), new Promise(r => es.end(r))]);

  const t = grade(problemDir, work);
  writeFileSync(join(runsDir, `${tag}.tests.txt`), `${t.stdout ?? ""}${t.stderr ?? ""}`);
  writeFileSync(join(runsDir, `${tag}.final.txt`), finalMsg + "\n");
  const traceText = existsSync(traceFile) ? readFileSync(traceFile, "utf8") : "";
  if (traceText) writeFileSync(join(runsDir, `${tag}.traces.jsonl`), traceText);
  // Collect child trace files for orchestrate mode. Child files are written by makeChildSession to
  // runsDir with names like <timestamp>-child-<pid>.jsonl; each starts with a session event carrying
  // parentTag = basename(parentTraceFile, ".jsonl") = `${tag}-branch`.
  const allTraces: { name: string; text: string }[] = [{ name: tag, text: traceText }];
  if (mode === "orchestrate") {
    const parentTag = `${tag}-branch`;
    for (const f of readdirSync(runsDir)) {
      if (!f.endsWith(".jsonl") || !f.includes("-child-")) continue;
      try {
        const childText = readFileSync(join(runsDir, f), "utf8");
        const sessionLine = childText.split("\n").find(l => l.includes('"session"'));
        if (sessionLine) {
          const ev = JSON.parse(sessionLine);
          if (ev.type === "session" && ev.parentTag === parentTag) {
            allTraces.push({ name: f, text: childText });
          }
        }
      } catch { /* skip unreadable files */ }
    }
  }
  m.orchestrateTurns = orchestrateTurnsFromTraces(allTraces, mode);
  m.subCost = subCostFromTraces(allTraces);
  const secTok = secondaryTokensFromTraces(allTraces);
  m.secondaryInputTok = secTok.input;
  m.secondaryOutputTok = secTok.output;
  rmSync(work, { recursive: true, force: true });
  const st = statusStr !== "ok" ? statusStr : m.isError ? "is-error" : "ok";
  if (st !== "ok") console.error(`[${tag}] ${st} — see ${errFile}`);
  const pass = t.status === 0 && st === "ok";
  let failReason: string | undefined;
  if (st !== "ok") {
    failReason = st;
  } else if (!pass) {
    const testsText = existsSync(join(runsDir, `${tag}.tests.txt`))
      ? readFileSync(join(runsDir, `${tag}.tests.txt`), "utf8") : "";
    const failLine = testsText.split("\n").find(l => /^FAIL(ED)?[: ]/.test(l));
    failReason = m.turns >= turnCap ? "turn-limit"
               : !anyEdit           ? "no-edit"
               : failLine           ? failLine.slice(0, 120)
               :                     "wrong-edit";
  }
  return { m, pass, status: st, failReason };
}

const activeKills = new Set<() => void>();
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { for (const k of activeKills) k(); process.exit(130); });

function makeSemaphore(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>(r => queue.push(r));
    active++;
    try { return await fn(); } finally { active--; queue.shift()?.(); }
  };
}

// Every problem's tests (incl. hidden) must fail on the unmodified code, else a do-nothing run would "pass".
function selfcheck(dirs: string[]) {
  let bad = 0;
  for (const d of dirs) {
    const work = workCopy(join(PROBLEMS, d));
    const t = grade(join(PROBLEMS, d), work);
    rmSync(work, { recursive: true, force: true });
    const ok = t.status !== 0 && existsSync(join(PROBLEMS, d, "hidden"));
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "BAD "} ${d}${ok ? "" : existsSync(join(PROBLEMS, d, "hidden")) ? " (tests pass unmodified)" : " (no hidden/ tests)"}`);
  }
  if (bad) process.exitCode = 1;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || (!a.problem && !a.selfcheck && !a['retry-failed'])) { console.log(HELP); return; }
  if (!a.problem) a.problem = "all";
  const report = a.report ?? "intent";
  if (!["intent", "none", "always"].includes(report)) throw new Error(`bad --report ${report}`);
  const allDirs = () => readdirSync(PROBLEMS).filter(d => statSync(join(PROBLEMS, d)).isDirectory()).sort();
  if (a.selfcheck) { selfcheck(allDirs()); return; }
  const dirs = a.problem === "all" ? allDirs()
    : a.problem.split(',').flatMap(p => readdirSync(PROBLEMS).filter(d => d.startsWith(p.trim())))
        .filter((v, i, arr) => arr.indexOf(v) === i);
  if (!dirs.length && !a['retry-failed']) throw new Error(`no problem ${a.problem}`);
  const timeoutS = Number(a.timeout ?? 900);
  const mainTurnCap = Number(a.turns ?? 40);
  if (a['orch-turns']) process.env.BRANCH_ORCHESTRATE_MAX_TURNS = String(a['orch-turns']);
  const backend = (a.backend ?? "openai") as Backend;
  const modes: Mode[] =
    a.mode === "compare" ? ["baseline", "branch-only", "orchestrate"] as Mode[]
    : a.mode === "both" ? ["baseline", "branch-only"] as Mode[]
    : a.mode === "all" ? ["baseline", "branch-only", "orchestrate"] as Mode[]
    : [a.mode as Mode];
  const runsDir = join(HERE, "runs", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(runsDir, { recursive: true });
  console.log(COLS.join("\t"));
  const all: Record<string, { m: Metrics; pass: boolean; status: string }[]> = {};
  type JobSpec = { dir: string; id: string; mode: Mode; i: number };
  const jobs: JobSpec[] = [];
  for (const dir of dirs) {
    const id = dir.split(/[-_]/)[0];
    for (const mode of modes) for (let i = 1; i <= Number(a.n); i++) jobs.push({ dir, id, mode, i });
  }
  if (a['retry-failed']) {
    const prevDir = join(HERE, 'runs', a['retry-failed']);
    const metaFiles = readdirSync(prevDir).filter(f => f.endsWith('.meta.json'));
    const retryJobs: JobSpec[] = [];
    for (const mf of metaFiles) {
      let meta: any;
      try { meta = JSON.parse(readFileSync(join(prevDir, mf), 'utf8')); } catch { continue; }
      if (meta.pass === false || (meta.status && meta.status !== 'ok')) {
        const tag = mf.replace('.meta.json', '');
        const parts = tag.split('-');
        const pid = parts[0];
        const n = parts[parts.length - 1];
        const mode = parts.slice(1, -1).join('-') as Mode;
        const dir = allDirs().find(d => d.startsWith(pid));
        if (dir) retryJobs.push({ dir, id: pid, mode, i: parseInt(n) });
      }
    }
    if (!retryJobs.length) { console.log('no failed jobs found in', a['retry-failed']); return; }
    jobs.splice(0, jobs.length, ...retryJobs);
    console.log(`retrying ${jobs.length} failed job(s) from ${a['retry-failed']}`);
  }

  const sem = makeSemaphore(Number(a.concurrency));
  await Promise.all(jobs.map(async ({ dir, id, mode, i }) => {
    const tag = `${id}-${mode}-${i}`;
    const r = await sem(() => runOneWithOpenAIBackend(join(PROBLEMS, dir), mode, a.model, runsDir, tag, report, timeoutS, mainTurnCap));
    writeFileSync(join(runsDir, `${tag}.meta.json`), JSON.stringify({
      model: a.model, backend: "openai", mode, problem: id, pass: r.pass, status: r.status,
      turns: r.m.turns, cost: r.m.cost, subCost: r.m.subCost,
      durationMs: r.m.durationMs, inputTok: r.m.input, outputTok: r.m.output,
      totalTok: r.m.input + r.m.output + r.m.secondaryInputTok + r.m.secondaryOutputTok,
      cacheRead: r.m.cacheRead, cacheCreate: r.m.cacheCreate,
      branchCalls: r.m.branchCalls, delegateCalls: r.m.delegateCalls,
      orchestrateTurns: r.m.orchestrateTurns, returnUser: r.m.returnUser,
      secondaryInputTok: r.m.secondaryInputTok, secondaryOutputTok: r.m.secondaryOutputTok,
      msgChars: r.m.msgChars,
      ...(r.failReason !== undefined ? { failReason: r.failReason } : {}),
    }));
    (all[`${id} ${mode}`] ??= []).push(r);
    console.log(row(tag, r.pass ? "pass" : "FAIL", r.status, r.m));
  }));
  // Means per problem+mode, over runs that completed (status ok); failed-to-complete runs only count in ok/status.
  for (const [key, runs] of Object.entries(all)) {
    const rs = runs.filter(r => r.status === "ok");
    const mean = (f: (m: Metrics) => number) => rs.length ? rs.reduce((s, r) => s + f(r.m), 0) / rs.length : NaN;
    const mm: Metrics = { turns: mean(m => m.turns), cost: mean(m => m.cost), durationMs: mean(m => m.durationMs), input: mean(m => m.input),
      output: mean(m => m.output), cacheRead: mean(m => m.cacheRead), cacheCreate: mean(m => m.cacheCreate), branchCalls: mean(m => m.branchCalls), delegateCalls: mean(m => m.delegateCalls),
      returnUser: false, isError: false, subCost: mean(m => m.subCost), msgChars: mean(m => m.msgChars), orchestrateTurns: mean(m => m.orchestrateTurns),
      secondaryInputTok: mean(m => m.secondaryInputTok), secondaryOutputTok: mean(m => m.secondaryOutputTok) };
    const line = row(`MEAN ${key}`, `${runs.filter(r => r.pass).length}/${runs.length}`, `${rs.length}/${runs.length}`, mm).split("\t");
    line[COLS.indexOf("retUser")] = `${rs.filter(r => r.m.returnUser).length}/${rs.length}`;
    console.log(line.join("\t"));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
