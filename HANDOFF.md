# AI Workflow — Handoff

> **To resume**: read this file, then see the [Roadmap](README.md#roadmap) in the main README for pending work.

---

## Specs: Final

The Anthropic prior-art comparison is in orchestrate §2.1 and §10.2 and in the README.

**Open prior-art follow-ups:**
- Orchestrate bets that delegation cost (tokens, latency, lossy reports) is outweighed by cheaper actions. `resolve`,
  conditional intents and the re-read / planner-vs-executor token metrics (orchestrate §10.1) must show which cost
  dominates. Coding steps are interdependent (Anthropic: weaker fit for multi-agent).
- Branch's line-level trace (Anthropic PTC shows only logged/returned output) is a hypothesis to test.
- Anthropic's numbers are frontier-model results; results on deepseek-v4-flash are an open gap worth reporting.
- Consider rewriting branching-framework §1–2 to cite prior art and frame branch as the code-mode baseline/executor.

Spec review F1–F20 and the final check (2026-10-24) are complete; all feature specs are **Final**
(changes now need the user's approval). Notable final-check decisions: Claude Code plugin uses a
hooks module (prompt.compose / tool.call routing / tool.describe deferral) instead of agents +
settings.json; read-only mode denies non-read calls; task.md is the first user message; budget
per framework-runner §6.5 (CLAUDE.md updated); large dev problem deferred until `fulfil` exists.

**Next (in order):**
1. ~~Sort out the uncommitted working tree~~ — done 2026-10-24 (tree clean).
2. Rebuild the codebase to the architecture specs (README Roadmap step 2): ~~telemetry~~ (done 2026-10-24,
   `packages/telemetry`) → ~~LLM client~~ (done 2026-10-24, `packages/llm`) → ~~core branch runtime~~ (done
   2026-10-24, `packages/core/src/branch`) → ~~core tool registry, hosts and wrappers~~ (done 2026-10-24,
   `src/registry`, `src/host`, `src/selection/bm25.ts`) → ~~`buildFramework` + prompts~~ (done 2026-10-24,
   `src/framework`, `prompts/{base,branch-only,branch-tool}.md`; baseline + branch-only only) →
   ~~orchestrate engine~~ (done 2026-10-24, `src/orchestrate/`, `src/refs/`, `src/registry/distractors.ts`;
   `buildFramework` now builds `orchestrate`, `branch-only[toolSearch]`, `catalog=N`).
   Prompts `rerank.md`, `executor.md`, `orchestrate.md`, `do-tool.md`, `resolve-tool.md` and the executor's
   fixed `branch` description approved by the user 2026-10-24. Distractor set (`catalog=N`): 50 domains × 24
   verbs with per-domain vocabulary and fields; 0 near-duplicate warnings up to N=1200 (wording repeats beyond).
   **Not built yet:** hot paths (`hotPaths: on` throws; arch §4.5), `orchestrate[executor=calls]`,
   declaration cap / `tools` inner call inside executors (core-tools-and-hosts §6 row `orchestrate`).
   **`@aiw/tools` done (2026-10-24):** all 53 tools; `catalog("L")` complete, `partial` removed. Python
   sidecar `packages/tools/python/aiw_sidecar` (dev venv via `npm run setup:venv`). Choices: tool-catalog
   A-30–A-34; refactor `unsure` kept per user (tools §6.4). Test group: A-35 (approved; coverage is
   line-only).
   **Done (2026-10-25):** `@aiw/server` (`packages/server/`): LocalHost, McpClientHost stub, MCP stdio server with tools/list + tools/call, throttled progress, durationMs meta. `@aiw/runner` (`packages/runner/`): full CLI (eval/report/problems/view), config/plan/scheduler/loop/rundir/combine; Docker ops (container.ts, mcp.ts, grade.ts) and problems build/check are stubs pending Docker environment.
   **Then:** wire Docker stubs and run step 3 (clean `compare`).
   Engine packaging resolved 2026-10-24 (core-branch §4.1, I-11 revised): QuickJS-WASM default,
   isolated-vm optional, shipped beside the bundle; containers use `--engine isolated-vm`.
3. ~~Wire Docker stubs~~ done 2026-10-25 (`da05649`): `container.ts` (real docker CLI), `mcp.ts`
   (MCP client via `@modelcontextprotocol/sdk` StdioClientTransport), `grade.ts` (docker cp +
   git diff --no-index + fresh-container check.sh), `problems/index.ts` (build + 5-step self-check),
   `job.ts` wired. 97 tests pass.
   **Before step 4:** the experiment problems in `experiments/problems/` are old-format (no
   `task.json`, `workspace/`, `checks/`, `Dockerfile`). A smoke problem must be created at
   `experiments/problems/01-chunk-off-by-one/` (the spec placeholder) plus the `aiw-base` Docker
   image before `aiw problems check` and `aiw eval` can run.
4. Create the smoke problem (`01-chunk-off-by-one`) in the new spec format and the `aiw-base` image,
   then run `aiw problems check smoke` and `aiw eval --problems smoke --mode compare --reps 1
   --budget 0.50`. — Roadmap step 3.
5. Only then: user's new orchestrate idea (adds one mode) — not yet presented; it goes through spec approval.
6. After that: optional branch coverage for `coverage` (`sys.monitoring` BRANCH events; tools §6.5, A-35).

Commit spec/README changes as `docs:` commits when the user approves.

---

## Code state

**The codebase has been fully rewritten** in `packages/` from scratch against the architecture specs.
All 6 packages are complete as of 2026-10-25 (97 tests pass, `npm test` at repo root):

| Package | What it covers |
|---------|----------------|
| `@aiw/telemetry` | Reporter, FileSink, TranscriptWriter, wrapLLM |
| `@aiw/llm` | createChatClient, LLMError |
| `@aiw/core` | branch runtime (compile/isolate/render), tool registry+hosts, framework builder, orchestrate engine, BM25 reranker, prompts |
| `@aiw/tools` | All 53 tools (catalog L); Python sidecar `aiw_sidecar` |
| `@aiw/server` | MCP stdio server (LocalHost, tools/list+tools/call, throttled progress) |
| `@aiw/runner` | eval/report/problems/view CLI; scheduler, loop, Docker container+MCP client+grader, problems build+check |

The old `framework/` directory (pre-spec, not a workspace) is dead code; nothing in `packages/`
references it. It should be deleted once the first eval run confirms the new pipeline works.

`packages/core/src/branch/` implements core-branch.md (compile → isolate run → render; 59 tests).
Implementation choices are recorded in core-branch.md (event shapes, line-preserving compile,
root-only `return` events, render details, engines). Engines in `src/branch/engines/`
(`quickJSRuntime` default, `isolatedVMRuntime`, `selectRuntime`). `npm test` runs QuickJS;
`npm run test:ivm` runs isolated-vm. Not yet built: the server's `--engine` flag, plugin packaging
of isolated-vm and the first-session note (framework-server §7.1), `engine` in run provenance.

Tool-layer, telemetry and LLM-client implementation choices are recorded in the specs (approved
2026-10-24): core-tools-and-hosts A-28, telemetry A-27 (amended), runner A-29. CompositeHost name
collisions are errors (framework-server §3 aligned).

### Old `framework/core/branch/`

`branch.ts` (+ `framework/test/core-branch.test.ts`, committed 3f6aeb9) is an early in-process runner from 2026-10-21. It
predates the architecture specs and does not match them (no isolate, instrumentation, recorder, `state` or renderers).
Rebuild it per architecture/core-branch.md rather than patching it; the old `src/runner.ts` path is replaced afterwards.
npm workspaces root (A-02) exists: `npm test` / `npm run typecheck` at the repo root; `framework/` is not a workspace.

---

## Autonomous loop

**To resume:** read this file, then continue the next steps above.

**Subagent policy — for token efficiency and cache health, not speed:**
The goal is to keep the main session context small and stable so the prompt cache stays warm across turns. Do NOT run subagents in parallel; run them sequentially, one step at a time.
- Spawn an `implementer` agent (`model: "sonnet"`) for every self-contained code change. Pass it the spec section, exact files and what to build; get back a short report (findings + paths, no code dumps).
- Spawn a `codebase-memory-scout` agent (`model: "haiku"`) for lookups (where is X, what calls Y). Haiku is cheap; keeps bulky tool output out of main context.
- Spawn an `Explore` agent (`model: "haiku"`) for broad file searches.
- Keep the main session to: reading HANDOFF.md, briefing subagents, reviewing their short reports, running `npm test`, committing, and updating HANDOFF.md. Do NOT do implementation or large reads inline.

**Per step:**
1. Read the relevant spec section (`docs/specifications/`).
2. Spawn the appropriate subagent with a self-contained brief (spec reference, file paths, what to build/change).
3. Review the report; run `npm test` at the repo root.
4. Commit (message format per CLAUDE.md; `npm test` must pass first).
5. Mark the step done in this file and move to the next.

**Hard rules:**
- NEVER edit `docs/specifications/features/` files. If a change is needed there, write it to `.claude/pending-review/YYYY-MM-DD-HH-MM-topic.md` (use `.claude/pending-review/TEMPLATE.md`) and continue to the next unblocked step.
- Architecture specs (`docs/specifications/architecture/`) may be updated to record implementation choices; flag conflicts with a feature spec in pending-review instead of silently resolving them.
- If a step needs a user decision (design choice, missing info, ambiguous spec), write it to `.claude/pending-review/` and continue.

**Stop when:** all "Next (in order)" steps are done, or 2–3 milestones complete and it's a natural handoff point, or only blocked steps remain. Update this file with current state before stopping.
