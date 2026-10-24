# Architecture: Runner

**Derived from:** [framework-runner.md](../features/framework-runner.md), [problems.md §7](../features/problems.md)  
**Package:** `@aiw/runner` (binary `aiw`)

---

## 1. Modules

| Module | Responsibility | Spec |
|--------|----------------|------|
| `cli.ts` | Commands and flags | — |
| `config.ts` | Resolve run configuration, framework variants, provenance | §6.6, §7.1 |
| `plan.ts` | Expand config into jobs; cost projection | §6.5 |
| `scheduler.ts` | Job queue, concurrency, budget stop, run status | §6.5 |
| `job.ts` | One job attempt end to end | §6 |
| `loop.ts` | Main-session model loop | §5.6 |
| `container.ts` | Docker image build/inspect, start, exec, cp, kill | §6.4 |
| `mcp.ts` | MCP client to the in-container server | §6.4 |
| `grade.ts` | Diff and fresh-container grading | §6.4 |
| `rundir.ts` | Run directory writer | §7 |
| `combine.ts` | Combined reports, failure gate, auto-repeat | §6.6 |
| `problems/` | `build`, `check` (self-check) | problems §6–7 |

---

## 2. CLI

```
aiw eval    --problems <ids|all|small|large> --mode <baseline|branch-only|orchestrate|compare|variant,...>
            --tools S|L  --reps 1  --model deepseek/deepseek-v4-flash  [--temperature 0]
            --budget 0.50  --concurrency 2  [--branch-context trace|annotated|full]
            [--secondary-cap 4]  [--until-reps N --combine-with <report>]
aiw report  <run-dir>... --name <report-name>          # combine (§8)
aiw problems build [<id>...]                             # codebase + overlay → workspace (problems.md)
aiw problems check [<id>...]                             # self-check (problems.md §7)
aiw view    [--watch]                                     # viewer indexer (viewer.md)
```

Framework variants are written `base[key=value,...]` (e.g. `orchestrate[secondary=2]`), matching
the viewer's naming (viewer §3). The canonical string (keys sorted) is the framework id in job
directory names and `run.json`.

> **Decided A-17 (2026-10-23, approved):** Keep `--mode` and its names (incl. `compare` = all three) from current
> project usage; add `--tools`; rename `--n` → `--reps`; drop `--retry-failed`, which the spec
> replaces with automatic retries + invalid runs + combining (§7, §8).

---

## 3. Run lifecycle

1. **Resolve config** and provenance (§9). Refuse to start if: model is `anthropic/*` on
   OpenRouter; any selected problem fails or lacks a passing self-check stamp (problems.md §7);
   cost is not API-reported by the configured endpoint (§6.5).
2. **Project cost**: mean cost per (problem, framework, tier) over the valid combined history
   (`experiments/reports/*` and valid runs with matching config) × planned jobs; refuse if above
   budget. No history → no projection, start allowed (§6.5).
3. **Build images** for selected problems if missing (`docker build`), record digests.
4. **Schedule** jobs over `--concurrency` workers.

> **Decided A-15 (2026-10-23, approved):** Default concurrency 2: keeps OpenRouter rate limits and the budget stop
> (in-flight jobs can overshoot) under control. Order: interleave frameworks per problem so that a
> budget stop leaves paired data rather than one framework complete and another missing.

5. **Finish**: `run.json` status `complete`, or `invalid` with reason (budget, job failed after
   retries, interrupted). Totals from all job attempts.

---

## 4. Job attempt

```
start container ─▶ start server (docker exec -i) ─▶ MCP initialize + tools/list
   ─▶ model loop ─▶ stop server ─▶ export /work ─▶ diff ─▶ grade ─▶ job.json ─▶ remove containers
```

### 4.1 Container

`docker run -d --network <none|aiw-job-<id>> --mount type=bind,src=<jobdir>,dst=/out
--mount type=bind,src=<server-bundle>,dst=/opt/aiw/bundle,readonly <problem-image> sleep infinity`.
Network is `none` for every framework except orchestrate, whose container joins a per-job internal
network (`docker network create --internal`) where the only reachable endpoint is the LLM egress
proxy (§5.1). Tools therefore have no network in any framework (tools §3.6). A wall-clock
limit per job (default `turnLimit × 3 min`) kills the container (core-branch §4).

### 4.2 Model loop

OpenAI-compatible chat completions via `@aiw/llm` + `wrapLlm(role: "main")`:

- System prompt = base system prompt (shared, `@aiw/core/prompts/base.md`) + the framework's MCP
  `instructions` section. Tools = server's `tools/list` converted to function schemas.
- Each turn: request → response. Tool calls → dispatch (§4.3). No tool calls → end (final answer).
- Turn limit (`task.json.turnLimit`) counts main turns; reaching it ends the job as fail with reason
  `turn-limit` (§6.1). Secondary turns never count (§4.4).
- Temperature and model fixed per run.

### 4.3 Tool dispatch

- For each tool call: preallocate event id, `toolStart`, call the server with
  `_meta: { "aiw/parent": id, "aiw/harnessId": tool_call_id }`, write `tool` event on return.
- The server returns its measured execution time in `_meta["aiw/durationMs"]`; that value is used
  for the event and for the model-facing text (§4.3 of the feature spec: tool timing is model-facing).

> **Decided A-09 (2026-10-23, approved):** Tool results returned to the model end with a line `[tool time: N ms]`
> (all frameworks; for `branch` the per-call durations are already in the trace, and the line gives
> the whole program's time).

> **Decided A-25 (2026-10-23, approved):** Multiple tool calls in one assistant turn: catalog tools (`baseline`) are
> executed sequentially in the order given; framework tools (`branch`, `do`, `resolve`) are
> dispatched concurrently (orchestrate-engine §3.3). Concurrent `branch` calls are
> serialized by the server because they share `state` (core-branch §6; amended 2026-10-24).

### 4.4 Infra errors

Classified as infra (not counted, retried): HTTP 429/5xx/network/timeout from the LLM API
(main or nested — nested ones are signalled by the server via `_meta["aiw/infraError"]`), MCP
transport loss, container start failure, grading container failure. Everything else is a framework
outcome. A job killed by its wall-clock limit is a framework fail with reason `timeout`.

---

## 5. Server invocation

```
docker exec -i [-e OPENAI_BASE_URL=http://aiw-egress:8080/v1] <ctr> /opt/aiw-node/bin/node /opt/aiw/bundle/aiw-server.mjs \
  --framework <variant> --tier S|L --host local --root /work \
  --events /out/events.jsonl --transcript /out/transcript.jsonl --blobs /out/blobs \
  [--executor-model <model> --secondary-cap 4] [--branch-context trace]
```

Blobs are written to the job's `blobs/`; the run writer moves them into the run-level `blobs/`
at job end (dedup by hash, framework-runner §7).

### 5.1 LLM egress proxy (orchestrate)

For runs that include orchestrate, the runner starts one egress proxy container (`aiw-egress`) per
run, attached to the default bridge and to each orchestrate job's internal network. It forwards
only chat-completion requests to the configured `OPENAI_BASE_URL` and adds the `Authorization`
header itself, so the API key never enters a job container and model-written code (`bash`, branch
programs) can reach nothing else. The proxy logs usage per forwarded request; the runner adds any
cost not matched by a server `turn` event to the budget total and flags the job, so spend from
outside the executor loop cannot go unrecorded.

---

## 6. Grading

1. `docker cp <ctr>:/work <tmp>/after`.
2. `git diff --no-index --binary <problem>/workspace <tmp>/after` → `diff.patch` (paths rewritten to
   be relative to `/work`; generated caches such as `__pycache__/`, `*.pyc` and `.pytest_cache/` are
   excluded, as in orchestrate-engine §7).
3. Fresh container from the same image (`--network none`), `docker cp diff.patch` and
   `checks/` in, `cd /work && git apply --binary /tmp/diff.patch`, copy `checks/*` over `/work`,
   run `check.sh` with a 120 s timeout. Exit 0 = pass. Output → `check.log`.
4. A patch that does not apply is a framework fail with reason `patch-failed` (the diff came from
   the job itself, so this indicates e.g. special files, not an infra problem).

> **Decided A-05 (2026-10-23, approved):** The diff is computed on the host against the pristine problem workspace, not
> with git inside `/work`, so the workspace needs no `.git` (problems §5.8 forbids answers in
> history) and agent-side git use cannot affect grading.

---

## 7. Retries, budget, validity

- Infra error → attempt directory moved to `attempts/<n>/`, job restarted from scratch in a new
  container, backoff 10 s then 60 s, at most 2 retries (§6.5).
- After 2 failed retries: the scheduler stops dispatching, waits for in-flight jobs, marks the run
  `{ "invalid": "job-failed:<job>" }` (data-formats §1.1).
- **Budget**: the scheduler keeps a running total from every attempt's `turn.costUsd` (tailing
  `events.jsonl` after each tool call and turn). When total ≥ budget, in-flight jobs are cancelled
  (container killed), the run is marked `invalid: budget`.

> **Decided A-16 (2026-10-23, approved):** An LLM infra error inside an orchestrate executor aborts the whole job
> attempt (and is retried) instead of being returned to the planner as a failed `do`. This keeps
> provider flakiness out of framework outcomes, as framework-runner §6.1 requires.

---

## 8. Combining and staged evaluation

- `aiw report` loads run directories, rejects invalid runs and runs with uncommitted changes,
  checks that all §7.1 "must match" provenance fields agree, and that shared problems have the same
  task-folder hash. Output: `experiments/reports/<name>/report.json` (+ `report.md` summary).
- Aggregation is done by `@aiw/report` (pass rate + 95% Wilson interval, cost per successful job,
  paired per-problem comparison, failure gate at 90%), see [data-formats §4](data-formats.md#4-combined-report).
- `aiw eval --until-reps N --combine-with <name>`: loop of run → combine → gate; stops when the
  combined report reaches N reps per (problem, framework), the gate fails, or the next run's
  projected cost exceeds the remaining budget (§6.6).

> **Decided A-18 (2026-10-23, approved):** Combined reports live in `experiments/reports/<name>/` (committed), separate
> from run directories (gitignored).

---

## 9. Provenance

`config.ts` computes every framework-runner §7.1 field before the first job:

| Field | Source |
|-------|--------|
| Commit + dirty flag | `git rev-parse HEAD`, `git status --porcelain` |
| Base prompt | sha256 of `@aiw/core/prompts/base.md` |
| Framework fingerprints | Start each framework's server once in a throwaway container per tier, hash `instructions` + `tools/list`; plus every text the framework sends that `tools/list` does not show: executor prompt, reranker prompt, hot-path snippet set |
| Framework switches | `rerank`, `hotPaths`, executor interface: part of the canonical framework id (§2) |
| Models per role, temperature | config |
| Limits | per-problem `turnLimit`, secondary cap, branch trace limits/mode, branch timeout |
| Image digest per problem | `docker image inspect` |
| Runner version, run format version | package version, `FORMAT_VERSION` constant |
| Tool tier | config (tools §3.4) |
| Problem ids + task-folder hashes | sha256 over sorted file list + contents (excluding `reference/`) |
