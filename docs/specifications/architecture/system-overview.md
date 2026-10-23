# Architecture: System Overview

**Derived from:** all feature specs  
**Status:** Draft — contains items needing approval (see [README](README.md#register))

---

## 1. Components

| Component | Package | Feature spec | Role |
|-----------|---------|--------------|------|
| **Core** | `@aiw/core` | branching-framework, orchestrate, references, harness-integration §4 | Branch runtime, tool registry and declarations, `Host` interface, orchestrate engine, reference store. Harness-agnostic; never executes tools itself. |
| **Telemetry** | `@aiw/telemetry` | framework-runner §4–5 | Reporter, event schema, sinks, transcript writer, `wrapTools` / `wrapLlm`, rollups. |
| **LLM client** | `@aiw/llm` | framework-runner §4.1, harness-integration §8 | OpenAI-compatible chat-completions client with usage normalisation. Used by the runner's loop and by orchestrate executors. |
| **Tools** | `@aiw/tools` | tools | Catalog implementations (tiers S, L), `external` fixtures, Python analysis sidecar. |
| **Framework server** | `@aiw/server` | harness-integration Part A | MCP server exposing a framework (`baseline` catalog, `branch`, or `do` + `resolve`) over a configurable host. |
| **Runner** | `@aiw/runner` | framework-runner, problems §7 | CLI: runs evaluations, grades, combines runs, builds and self-checks problems. |
| **Report** | `@aiw/report` | framework-runner §6.2, viewer §4 | Pure aggregation over run directories (pass rates, Wilson intervals, cost per success, paired comparison, failure gate). Shared by runner and viewer. |
| **Viewer** | `@aiw/viewer` | viewer | Static React app plus an indexer that turns run directories into loadable data. |
| **Claude Code plugin** | `plugins/claude-code` | harness-integration Part B | Plugin bundle: manifest, main-thread agent, settings, session-context hook. Ships the server bundle. |
| **Problems** | `problems/` (data) | problems | Task folders, shared codebases, base image definition. |

---

## 2. Dependency rules

| Package | May depend on |
|---------|---------------|
| `telemetry` | — |
| `llm` | `telemetry` |
| `core` | `telemetry`, `llm` |
| `tools` | `core` (types and registration only) |
| `server` | `core`, `tools`, `telemetry`, `llm` |
| `report` | `telemetry` (record schemas) |
| `runner` | `report`, `telemetry`, `llm`, `core` (prompt strings only, see below) |
| `viewer` | `report`, `telemetry` (schemas) |

- `core` depends on `telemetry` (reporter types) and `llm` (executor calls); nothing else.
- `core` must not import `tools`, `server` or `runner`. Tools reach the core only through a `Host`.
- `server` composes `core` + `tools` + hosts. It is the only package that knows MCP.
- `runner` never imports `core` at job time: it talks to the server over MCP like any harness
  would. This keeps the measured path identical to the deployed path (harness-integration §2).
  The runner imports `core` only to read prompt/declaration strings for provenance hashes.
- `viewer` reads files only; it imports `report` for aggregation and nothing from the job path.

---

## 3. Process topology

### 3.1 During an evaluation job

```
 HOST                                              JOB CONTAINER (from problem image)
┌──────────────────────────────┐                 ┌───────────────────────────────────────────┐
│ aiw eval (runner)            │  MCP over stdio │ aiw-server --framework F --tier T          │
│  ├─ job scheduler            │  (docker exec)  │  ├─ core (branch runtime / orchestrate)    │
│  ├─ model loop (main session)│ ◀─────────────▶ │  ├─ LocalHost → @aiw/tools (cwd /work)     │
│  │    └─ @aiw/llm ──▶ API    │                 │  │     └─ python sidecar (ast/jedi/rope)   │
│  ├─ budget / retry / grading │                 │  └─ executor loop ─▶ @aiw/llm ──▶ API      │
│  └─ telemetry writer ─┐      │                 │        (orchestrate only)                  │
└───────────────────────┼──────┘                 │  telemetry writer ─┐                       │
                        ▼                        └────────────────────┼───────────────────────┘
          runs/<run>/jobs/<job>/  ◀── bind mount /out ────────────────┘
          events.jsonl, transcript.jsonl, blobs/

 After the job:  docker cp /work → host; diff on host; fresh GRADING CONTAINER applies diff + checks/
```

- The model loop for the **main session** runs on the host, in the runner (framework-runner §5.6).
- Every tool executes in the container (framework-runner §6.4): catalog tools for `baseline`,
  `branch` programs, and orchestrate's executors with their branch programs.
- The container process is the **same framework server** used in harness integration, with the
  runner host (`LocalHost` over the tool catalog). The `branch` description, `do` description and
  tool declarations the model sees are therefore byte-identical in experiments and in harnesses.

> **Decided A-03 (2026-10-23, approved):** Run the framework server inside the job container, so the orchestrate
> executor loop (and its LLM calls) also runs there. Consequences: the container needs outbound
> network and the API key (passed at `docker exec` time, never in the image); tools still make no
> network calls (tools §3.6).
> *Alternative:* the executor loop runs in the runner and only branch programs run in the
> container. That keeps keys and network out of the container, but splits the orchestrate engine
> across two processes and makes the experiment path differ from the harness path.

### 3.2 In a harness

```
 Harness (e.g. Claude Code) ── MCP stdio ──▶ aiw-server --framework F --host mirrored|fallback|native
                                              ├─ core
                                              └─ host → harness tools / own tools / discovered MCP servers
```

See [framework-server.md](framework-server.md).

---

## 4. Data flow of one job

1. Runner starts the job container and the server inside it; lists tools over MCP.
2. Runner records the system prompt and tool declarations as blobs; hashes go to provenance.
3. Model loop: request → response; each tool call is sent to the server with the runner's
   preallocated event id in `_meta` ([telemetry §3](telemetry.md#3-event-schema)).
4. The server executes; nested work (inner calls, executor turns, traces) is appended to the same
   job's `events.jsonl` / `transcript.jsonl` through the `/out` bind mount, parented under that id.
5. Loop ends on a final answer or the turn limit. Runner exports `/work`, computes `diff.patch`,
   grades in a fresh container, writes `job.json` with rollups computed from `events.jsonl`.

---

## 5. Runtime and language

> **Decided A-01 (2026-10-23, approved):** TypeScript on Node ≥ 22 for all packages; Python 3.12 only for the analysis
> sidecar that backs tier-L tools on Python code ([tool-catalog §4](tool-catalog.md#4-python-analysis-sidecar)).
> Rationale: branch programs are TypeScript and run in Node; MCP SDK and the viewer are JS; one
> language keeps types shared across server, runner and viewer.

Shared conventions:

- ESM, strict TypeScript, `node:test` for tests, `tsx` for running sources in development.
- Each package exports a small public `index.ts`; cross-package imports go through it only.
- Schemas for anything crossing a process or file boundary (MCP `_meta`, event records, run files)
  are defined once in `@aiw/telemetry` (events, transcript) or `@aiw/report` (run files) with
  runtime validation (`zod`), and versioned (`v` field).
- Server bundle: `esbuild` produces a single-file `aiw-server.mjs` used in containers and shipped
  in the Claude Code plugin.

---

## 6. Repository layout

> **Decided A-02 (2026-10-23, approved):** Replace the current `framework/` + `experiments/run.ts` structure with npm
> workspaces. Existing code is migrated into the packages below (or deleted); old run formats are
> not kept (project rule). Run commands were removed from `CLAUDE.md` (2026-10-23); the user adds the new ones.

```
package.json                 workspaces: packages/*, plugins/*
packages/
  core/      src/branch/  src/registry/  src/host/  src/orchestrate/  src/refs/
  telemetry/
  llm/
  tools/     src/ts/  python/  fixtures/
  server/
  runner/
  report/
  viewer/    src/  indexer/
plugins/
  claude-code/
problems/
  _base/                     aiw-base Dockerfile (tool-catalog §6)
  _codebases/fulfil/
  01-chunk-off-by-one/       smoke test, size "smoke" (problems §2)
  02-inventory-feature/ … L5-refund-double-count/
experiments/
  runs/                      gitignored run directories
  reports/                   combined reports (A-18)
docs/
```

---

## 7. Configuration and secrets

- Run configuration comes from CLI flags (runner §2) and is written verbatim to `run.json`.
- `OPENAI_BASE_URL` / `OPENAI_API_KEY` are read from the environment by the runner and passed to the
  container with `docker exec -e` only when the framework needs them (orchestrate). Never written
  to run files, images or logs.
- Model ids: experiments use `deepseek/deepseek-v4-flash` (project rule). The runner refuses
  `anthropic/*` model ids on OpenRouter.

---

## 8. Cross-cutting rules

- **No silent truncation.** Every cap (tool output 8 KB, trace values 200 chars, report size,
  planner `resolve` ~1k tokens) adds an explicit marker saying what was cut and how to get more.
- **Never throw across a boundary.** `runBranch`, host calls over MCP, and executor loops return
  result objects; only tools throw (by contract) and the core converts throws into results.
- **Deterministic text generation.** Declarations, traces, footers and reports' appended lines are
  pure functions of their inputs so their hashes are stable for provenance.
