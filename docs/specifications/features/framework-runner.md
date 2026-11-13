# Feature: Framework Runner

**Area:** Evaluation infrastructure  
**Related:** [branching-framework.md](branching-framework.md)

---

## 1. Summary

The framework runner executes an agent framework against a set of problems and records two things:

1. **What it cost** — per-turn token counts, cache status, dollar cost, model latency, and
   per-tool execution time, all taken from the API where the API is the source of truth.
2. **Whether it worked** — for each problem, decide if it was resolved using tests and file checks,
   and aggregate pass/fail rates over the problem set.

The runner exists for **testing**, not production use. Its primary job is to make a fair
cost-vs-success comparison between frameworks.

---

## 2. Motivation

The central experimental claim is:

> The branching framework reduces cost relative to baseline tool calling, at a similar or higher
> success rate.

To support or refute that claim, the runner must measure cost the same way for every framework
(so differences are attributable to the framework, not the measurement) and measure success
reproducibly (so differences are not noise from a drifting environment).

---

## 3. Concepts

| Term | Meaning |
|------|---------|
| **Framework** | A standalone agent interface under test (baseline tools, branch tool, orchestrate, …). It exists independently of any harness. |
| **Harness** | The agent loop a framework is attached to for actual use: sends messages to the model, executes tool calls, returns results. A framework cannot run without one. |
| **Runner** | The test harness: attaches a framework, runs it against problems, and records metrics and outcomes. |
| **Adapter** | Telemetry glue between a framework and a harness: a shared reporter plus a sink (§5). |
| **Problem** | Task description + starting environment + success checks. |
| **Environment** | The workspace the framework acts on, reproducible across runs (§6.4). |
| **Run / Job / Turn** | A run is one invocation over a problem set; a job is one framework × problem × repetition; a turn is one model request/response. |

---

## 4. Metrics capture (core)

### 4.1 Source of truth

All token counts come from the **API response**, never from local tokenisation. If the API does
not report a field, the runner records it as missing rather than guessing.

Every turn records **both** its token counts per category (uncached input, cached-read input,
cache-write, output) **and** a dollar price, so models with very different rates (a cheap
classifier, a main model, plan usage) can be compared per situation or in total:

- **API-reported cost** is recorded when the provider returns one (e.g. OpenRouter `usage.cost`).
- **Price-table cost** is computed from the token counts and a versioned price table per model
  (rates per category; time-of-day rates such as DeepSeek off-peak are separate entries). The
  record names the table version, so prices can be recomputed later from the stored tokens.
- **Plan usage** (ChatGPT sign-in) has no per-token bill; it is priced at the same model's public
  API rates as an **API-equivalent** cost, marked as such. It is never mixed with billed cost.

Each API type reports usage in its own shape, so the runner normalises it per API type into one
`Usage` record (input, output, cached-read and cache-write tokens, cost). Supported API types:

| API type | Usage fields | Cost |
|----------|--------------|------|
| OpenAI-compatible chat completions (incl. OpenRouter) | `usage.prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens` | OpenRouter: `usage.cost`; plain OpenAI: not reported |
| OpenAI Responses | `usage.input_tokens`, `output_tokens`, `input_tokens_details.cached_tokens` | not reported |
| Anthropic Messages | `usage.input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` | not reported |
| Gemini | `usageMetadata.promptTokenCount`, `candidatesTokenCount`, `cachedContentTokenCount` | not reported |

Direct providers (DeepSeek, TypeSafe) report no dollar cost, so their cost comes from the price
table. A model with no price-table entry has its cost recorded as missing. Adding an API type
means adding one usage normaliser; adding a model means adding its price-table entry.

**Models (project decision, 2026-11-13):**

| Role | Model | Access | Use |
|------|-------|--------|-----|
| Main and secondary (measured runs) | `deepseek-v4-flash` | DeepSeek API, direct | dev, pilot and full runs |
| Selection classifier (orchestrate §7.2) | `jev-1.14` | TypeSafe Decisions API, direct | all runs |
| Development only | ChatGPT plan model | ChatGPT sign-in (plan usage) | prompt and framework development; never combined or reported |

Claude/Anthropic models are not used for experiments.

### 4.2 Per-turn metrics

| Metric | Source |
|--------|--------|
| Input tokens | API usage |
| Output tokens | API usage |
| Cached input tokens | API usage (provider-dependent) |
| Cache hit (whether the turn was served from cache, fully or partly) | API usage (provider-dependent) |
| Cost (USD) | API-reported cost |
| Model latency (request → response) | Runner clock |

### 4.3 Per-tool-call metrics

Each tool execution is timed separately from model latency. For frameworks where one turn can do a
lot of tool work (branch), this distinguishes "the model was slow" from "the tools were slow".

Tool timing is also **model-facing**: the duration is returned to the model as part of the tool
result (for branch, it is already part of the execution trace — see branching-framework §7.1).

### 4.4 Fairness controls

Held constant across frameworks within a run:

- Model and temperature.
- **Base turn limit** (main-loop turns) per problem. Orchestrate's secondary-LLM ("subagent") turns
  are counted and reported separately and do not consume the base limit.
- **Secondary turn cap**: at most 4 secondary turns per `do` call (at most 4 executor turns; one is the normal case; configurable, orchestrate §8.2).
  Their cost is always included in the job's total (§4.5).
- Base system prompt, excluding framework-specific sections.

Recorded, **not** controlled:

- Caching. Cache hits are part of a framework's real cost (e.g. branch uses fewer turns and may get
  fewer cache hits), so they are measured as-is rather than forced warm or cold.

### 4.5 Nested LLM calls

Frameworks like orchestrate make secondary LLM calls inside a tool call. These calls are invisible
to the harness, so the framework reports them through the reporter (§5). They are recorded **both**
ways:

- **As a tree.** Each event has a parent, so a job reads as main turn → tool call → secondary turns
  → their tool calls. This is kept for inspection.
- **As rollups.** The runner computes totals from the tree: total cost (including nested calls),
  main turns and secondary turns as separate counts (§4.4), and top-level and leaf tool calls as
  separate counts.

Each `turn` event records its model, so a secondary loop running on a different model stays visible.

---

## 5. Framework adapters

The runner core is framework-agnostic. An adapter's only job is **telemetry**: it reports what the
framework did (LLM calls, tool calls, their cost and timing) so that every framework is measured the
same way. Turn limits, the job lifecycle, and infra-error classification stay in the runner.

### 5.1 Why frameworks report

A harness only sees its own model turns and the top-level tool calls it dispatches. Anything that
happens *inside* a framework's tool is invisible to it:

- **branch:** the program's inner tool calls run inside the single `branch` call.
- **orchestrate:** the secondary LLM calls are made by the framework, not the harness. If the
  framework doesn't report them, their cost is missing and the framework looks cheaper than it is.

So the framework itself must report this work, in every harness, not just in the runner.

### 5.2 Reporter

A single shared **reporter** library is used by all frameworks. It owns the event schema, parent ids,
and timestamps. Frameworks call it the same way regardless of which harness they run in.
The interface below is illustrative; the approved one is in [architecture/telemetry.md §2](../architecture/telemetry.md).

```ts
interface Reporter {
  turn(e: { model: string; usage: Usage; costUsd?: number; latencyMs: number }): void;
  tool(e: { name: string; args: unknown; ok: boolean; durationMs: number }): void;
  child(label: string): Reporter;   // nested scope; events inside get this scope as parent
  attach(key: string, data: unknown): void;  // inspection data (§5.4)
}
```

- `usage` and `costUsd` come from the API response (§4.1); fields the API doesn't report are left
  missing.
- The harness hands the framework a reporter **already scoped to the current tool call**. Every
  event the framework records nests under that call without the framework knowing its id.
- Convenience wrappers (`wrapTools(tools, reporter)`, `wrapLLM(client, reporter)`) report
  automatically, so frameworks don't hand-write the plumbing. For branch, inner calls are reported by
  wrapping the `Tools` map passed to `runBranch` (the tracing-as-wrapper approach from the branch
  core).

### 5.3 Sinks

The reporter writes events to a **sink**: the destination for the event stream. There is one sink
type, an append-only JSONL file per job. The runner reads that file to build the job's event tree.
The same file sink works when a framework is attached to another harness (§8), so frameworks need
no harness-specific code.

The sink must satisfy:

- **Process boundaries.** The framework may run in a separate process from the harness (e.g. as a
  tool server), so the event format must be serialisable and writable to a file or stream, with no
  in-memory hand-off required.
- **Crash safety.** Events are written as they happen, append-only, so a crashed job keeps
  everything recorded up to that point.
- **Correlation.** A harness's tool-call id may not reach the framework. Each top-level event carries
  enough to be matched to the harness's own record of the call afterwards (tool name, args,
  timestamps, and the harness id when available).
- **No-op default.** With no sink configured the reporter does nothing, so frameworks behave
  normally outside experiments.

### 5.4 Metrics stay fixed

The runner computes every comparable metric (§4, §6.2) from `turn` and `tool` events. Frameworks
cannot add metrics to the comparison. Framework-specific data goes through `attach` (branch:
rendered execution trace and full event stream; orchestrate: handoff record per `do` call,
[orchestrate.md §8.4](orchestrate.md)). It is shown for inspection and never aggregated.

### 5.5 Subagents

The runner's own loop has no harness subagents; nested work comes only from frameworks (§5.1).
When a framework is attached to a real harness (§8), a harness subagent has the same event-tree
shape as orchestrate's `do` (a `tool` event with child `turn` and `tool` events), so rollups
would treat both the same way.

### 5.6 Baseline and the base prompt

**Baseline** is the control condition: plain function calling, as in most agent harnesses.

- **Tools:** the same catalog as the other frameworks at the run's tier (tools §1). Every tool's
  schema is sent on every turn; each tool call is dispatched directly and its result returned as
  a tool message.
- **Prompt:** the base prompt only; baseline adds no framework-specific section.
- **Job end:** a response with no tool calls is the final answer and ends the job; otherwise the
  job ends by turn limit, wall-clock limit or context limit (§6.1). Grading follows (§6.4).

The **base prompt** is shared by every framework (§4.4) and held fixed per run (its hash is part of
provenance, §7.1). Frameworks append their own section after it. It contains only:

1. **Role.** A coding agent working in a repository at `/work`.
2. **Autonomy.** No user is available to answer questions; make reasonable assumptions and finish.
3. **Verification.** Check the change before finishing, e.g. by running the project's tests if any.
4. **Ending.** Finish with a short summary of what changed, without calling a tool.

The problem's `task.md` is the **first user message**, verbatim, as a user would type it in a
harness. The system prompt is therefore identical for every problem within a framework.

It names no tools and gives no problem-specific or strategy hints, so nothing in it favours one
framework.

### 5.7 Harness choice

**Decided: own minimal loop**, an OpenAI-compatible chat-completions loop owned by the runner.

The thing under test is the tool interface itself, so the runner must own the loop and tool
dispatch:

- One loop for all frameworks is the strongest fairness control (§4.4); no third-party prompt
  scaffolding.
- Branch's inner calls and orchestrate's secondary calls happen inside a tool call, so the reporter
  (§5) is needed regardless. An eval framework (e.g. Inspect AI) would add a Python↔TS bridge to the
  branch tool without removing that work.
- Cost comes from the API (§4.1), so no framework-side usage accounting is needed.

**Borrowed from benchmark harnesses** (SWE-bench / Terminal-Bench): the problem format and
Docker-per-task checks — a task folder with an instruction, a Dockerfile, and a test script run
inside the container whose exit code decides pass/fail (§6.1).

The runner does **not** drive real harnesses (e.g. Claude Code headless); see §8.

---

## 6. Task resolution

### 6.1 Success criteria

Each problem defines checks (tests, file checks) that decide pass/fail after the job finishes.
Each problem also defines its own **turn limit**, since some problems inevitably need more turns.

| Job ends with | Counts as |
|---------------|-----------|
| Checks pass | pass |
| Checks fail | fail |
| Turn limit reached | fail (recorded with reason `turn-limit`) |
| Job wall-clock limit reached (e.g. an endless loop) | fail (reason `timeout`) |
| Final patch does not apply to the grading workspace | fail (reason `patch-failed`) |
| Context length exceeded | fail (reason `context-limit`) |
| Infrastructure failure: API server down or unreachable, rate limit, API request timeout, empty or content-filtered response | **not counted**; retried (§6.5) |

A malformed tool call (e.g. invalid argument JSON) does not end the job: it is returned to the
model as a tool error, and the model may retry.

Each problem is a benchmark-style task folder (§5.7):

```
problems/<id>/
  task.md      instruction shown to the model
  task.json    turn limit, tags
  Dockerfile   job environment; the workspace is /work
  workspace/   starting files, copied to /work
  checks/      hidden tests + check.sh (exit code 0 = pass); never present during the job
```

### 6.2 Reporting

Per framework, over all jobs in the evaluation (§6.6):

- **Pass rate**, with a 95% Wilson interval.
- **Cost per successful job** — the headline number for the cost claim.
- **Paired per-problem comparison** (e.g. branch vs. baseline on the same problem), so a few hard
  problems do not dominate the aggregate.
- **Claim rule (stated before the full run).** With one repetition the full run can detect only
  large differences. The report computes the minimum detectable difference for the run's size,
  and a difference is claimed only if the paired comparison exceeds it; smaller differences are
  reported as inconclusive, never as wins.

### 6.3 Action log

Each job logs **both**:

- **Tool calls** — the event tree from the reporter (§4.5, §5), including nested calls.
- **File diffs** — the workspace before vs. after the job.

### 6.4 Reproducibility and grading

Each job's environment is a **Docker container** built from a fixed image, so every job starts
from an identical environment (same files, toolchain versions, dependencies). The purpose is
reproducibility of experiments, **not** security isolation; branch programs are isolated separately (branching-framework §5.2) and
the container is the outer boundary.

**Tools execute inside the container**, served by an MCP tool server running there, so the agent acts
as if it were running in the container itself. Framework tools that run code (e.g. `branch`) also
run in the container. The model loop can run either on the host or, with the whole experiment set,
inside Docker; both are acceptable. In either case API keys are passed in at runtime, never baked
into the image, and model latency and tool time are measured separately.

**Grading runs in a fresh container**, never the job's own:

1. After the job ends, take the diff of `/work` (also the action log's file diff, §6.3).
2. Start a fresh container from the same image and apply the diff.
3. Copy in `checks/` (overwriting any same-named files, e.g. `conftest.py`) and run `check.sh`.

The hidden tests are never reachable during the job, so the agent spends no turns finding them, and
nothing it changed outside `/work` reaches grading.

### 6.5 Retries, validity and budget

The goal is that **every job ends with a pass/fail outcome**, since a framework comparison is not
valid over incomplete jobs.

- An infra error (§6.1) retries the job from scratch, up to 2 retries with backoff.
- If a job still fails after its retries, the run **stops**. The run is marked **invalid**: its
  results are kept for debugging but never used in reports or combined with other runs (§6.6).
- **Budget** is set per run: default $0.50 for dev and pilot runs (§6.6), and $1 for the full
  run. Every attempt's cost counts, including failed and
  retried ones. Before starting, the runner projects the run's cost from earlier combined runs
  (when there are any) and refuses to start if the projection exceeds the budget. If cost still
  reaches the budget mid-run, the run stops and is marked invalid.
- The budget counts every role's cost (main, secondary, selection classifier), API-reported or
  price-table (§4.1). If any model in the run has neither, the runner refuses to start.
- Runs on plan usage are dev-only: they track API-equivalent cost against the budget the same way,
  but are never combined or reported (§6.6).

### 6.6 Staged evaluation

Evaluation grows in small runs rather than one large one, so a broken setup is caught cheaply, and
the expensive full run happens once.

- A run's size is configurable: which problems, which frameworks, and repetitions per problem
  (default 1).
- Results from several valid runs are **combined** into one report, as if they were a single larger
  run. Only runs with the same configuration (see §7.1) can be combined.
- **Dev runs** use the dev set (problems §8.5) to tune the frameworks.
- **Failure gate (temporary, dev set only).** After each dev run, the combined report checks every
  framework's pass rate against a threshold (default 90%). Below it, the report flags the framework
  and the failing problems. Every failure is audited and labelled `setup` (bug in the problem,
  runner or tools) or `framework` (weakness to tune). Remove the gate together with the dev set.
- **Setup gate (permanent).** Before any run on the reported set: the smoke test and every
  problem's reference solution pass, and no audited failure is still labelled `setup`.
- **Pilot runs** use part of the reported set (e.g. small problems at tier S) to check the setup
  and to measure cost per job. Their results are never tuned against.
- **Full run.** The whole reported set, with a $1 budget. The runner refuses to start it unless the
  setup and failure gates pass, the cost projection from pilot runs fits the budget, and no full run
  exists yet for the same provenance (§7.1).
- The runner can repeat automatically: run, combine, check the gate, and start the next run, until
  a target number of repetitions is reached, the gate fails, or the budget would be exceeded.
- **Tuning is a spec change.** A framework change made to pass the gate is reviewed and approved
  like any spec change, except for minor bug fixes. Every change is checked twice for overfitting:
  it must not encode knowledge of a specific problem (dev or reported), only general behaviour.

---

## 7. Output

Each run is a self-describing directory. Events are the source of truth; summaries are derived
from them and can be rebuilt.

```
runs/<run-id>/
  run.json              configuration, provenance (§7.1), status (complete | invalid + reason), totals
  jobs/<problem>.<framework>.<rep>/
    job.json            outcome, rollups (§4.5), attempts, cost of all attempts
    events.jsonl        reporter sink (§5.3), final attempt
    transcript.jsonl    model requests and responses, final attempt, nested sessions included
    diff.patch          workspace diff (§6.3)
    check.log           check.sh output
    attempts/<n>/       events and transcript of retried attempts, for debugging
  blobs/<hash>.txt      system prompts and tool declarations, stored once per run
```

`transcript.jsonl` records **every** model request and response in the job verbatim, including
nested sessions (orchestrate executors, §4.5). Each entry carries the id of its `turn` event, so it
can be placed in the event tree and grouped into conversations. System prompts and tool
declarations are not repeated in each entry: they are stored once under `blobs/`, keyed by the
hashes recorded in `run.json` (§7.1), and entries refer to them by hash.

Combined reports (§6.6) are computed from several run directories and are not stored inside any of
them. The experiment viewer reads run directories and combined reports; it is built for this
format, not the other way round.

### 7.1 Provenance

`run.json` records what produced the run, so results can be traced and runs safely combined:

| Field | Must match to combine |
|-------|-----------------------|
| Code version (commit) and whether there were uncommitted changes | yes |
| Hash of the base prompt (§5.6) | yes |
| Hash of each framework's system prompt and tool declarations | yes |
| Model per role (main, secondary) and temperature | yes |
| Limits: per-problem turn limits, secondary turn cap, branch trace settings | yes |
| Tool tier (tools §3.4) | yes |
| Framework switches: `rerank`, `hotPaths`, executor interface (part of the framework id) | yes |
| Docker image digest per problem | yes |
| Runner version and run format version | yes |
| Problem set: problem ids and a hash of each task folder | no — runs may cover different problems; a problem present in several runs must have the same hash |

A run with uncommitted changes is recorded but cannot be combined, since it cannot be reproduced.

---

## 8. Out of scope

- Production use of frameworks; the runner is a test harness only.
- Security isolation of tools (belongs to the framework/environment; see branching-framework §5.2).
- Driving real harnesses (e.g. `claude -p`) from the runner. Attaching a framework to a real harness
  — for Claude Code, a bundle of MCP server, hooks, settings, and prompt/skill files — is a
  separate spec ([harness-integration.md](harness-integration.md)). The reporter and file sink (§5)
  are designed so that works without changes.

---

## 9. Open questions

None currently.
