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
4. **Done (2026-10-25):** Smoke problem + `aiw-base` image.
   - `experiments/docker/aiw-base/Dockerfile`; `aiw-base:latest` image built.
   - `experiments/problems/01-chunk-off-by-one/` fully rebuilt in new spec format.
   - `grade.ts` fixed: `cp -r workspaceDir tmp/before` + `cwd: tmp` + relative paths in diff +
     `git apply -p2`; also fixed `cp -r /tmp/checks /work/` (was `checks/.`) so check.sh lands
     at `/work/checks/check.sh`. Committed `0f21309` + `c3e56bd`.
   - `aiw problems check 01-chunk-off-by-one` → PASS (~7.8 s), 97 tests pass.
   - **Next:** port problems 02–09 to new spec format (see step 5 below), then full `compare` run on all 9.
   - **Server bundle required before eval.** `packages/server/` must be built first:
     `node packages/server/build.mjs` → produces `packages/server/dist/aiw-server.mjs` + prompts +
     isolated-vm + typescript-api alongside it. Rebuild whenever server or core source changes.
   - **Done (2026-10-25):** First valid `compare` run `2026-10-25T06-53-02Z-f8fd`:
     baseline PASS, branch-only PASS, orchestrate FAIL (turn-limit; model ran, $0.006 total).
     Fix committed `19ec0bb`: wire orchestrate LLM client (server.ts `ServerOptions` +
     cli.ts `--executor-model/--executor-api-key/--executor-base-url` + job.ts server args).
   - **Orchestrate now verified PASS** (`2026-10-25T08-35-01Z-72bc`, commit `2211117`).
     Root cause of original failure: container started with `--network none`; executor LLM calls
     (from inside the container) had no outbound access. Fix: bridge network for orchestrate
     (runner.md §5.1 egress proxy deferred — bridge is dev-only shortcut).
     All three roles firing: main (planner), selection (LLM reranker), secondary (executor).
     $0.00059, 146s, 50 turns (10 main + 8 selection + 32 secondary across 8 do calls).
   - **Model used:** `deepseek/deepseek-v4-flash`.
   - **Done (2026-10-25, `e8ad223`):** `@aiw/viewer` (`packages/viewer/`): React+Vite app + Node
     indexer. Indexer reads `experiments/runs/*/` → `dist/data/index.js` + per-job `.js` scripts
     (A-19 script-injection pattern). App: sidebar (run groups), framework tabs, Summary/JobsMatrix/
     Job views, ConversationView (events.jsonl → turn cards), DiffView, CheckLog, renderer registry.
     Hash routing. `aiw view` stub replaced. Branch/orchestrate framework renderers deferred.
     Server bundle rebuilt (2026-10-25). 298 tests pass.
   - **To re-run (with viewer):**
     ```
     node packages/server/build.mjs   # only if server/core source changed
     OPENROUTER_API_KEY=sk-or-... PATH="$PATH:$(pwd)/node_modules/.bin" aiw eval --problems 01-chunk-off-by-one --mode compare --reps 1 --budget 0.50 --model deepseek/deepseek-v4.1-flash --tools S
     # then: aiw view  (indexes runs + opens browser)
     ```
5. ~~Port problems 02–09~~ **Done 2026-10-25 (`0a40d6e`)**. All 9 problems check PASS.
   Also added gitignore rules for `check.log` and `diff.patch` under `experiments/problems/`.

   **New layout per problem** (mirror `01-chunk-off-by-one/`):
   ```
   experiments/problems/<id>/
     task.json       # metadata (problems §4)
     task.md         # the task prompt — terse, no meta
     workspace/      # source files the agent starts from (bug/gap already present)
     checks/check.sh # runs python -m unittest discover (or pytest); exit 0 = pass
     Dockerfile      # FROM aiw-base:latest; COPY workspace/ /work/; RUN cd /work && git init ...
     reference/      # (optional) correct solution for grading reference
   ```

   **`task.json` fields** (problems.md §4):
   - `id`: problem folder name
   - `size`: `"small"` for all of 02–09 (single-file / small codebase)
   - `set`: `"dev"` for 03-discount-mismatch (problems §8.5); `"reported"` (omit field, it's the default) for 02, 04–09
   - `turnLimit`: pick conservatively — 8 for simple bugfixes, 12 for feature additions, 15 for multi-file/refactor
   - `tags`: from the tag vocabulary: `bugfix`, `feature`, `refactor`, `concurrency`, `multi-file`, `import-cycle`

   **Problems and their intended ports:**
   | # | name | tags | turnLimit |
   |---|------|------|-----------|
   | 02 | inventory-feature | `feature` | 12 |
   | 03 | discount-mismatch | `bugfix` | 8 |
   | 04 | vague-rate-limit | `feature` | 12 |
   | 05 | report-refactor | `refactor` | 12 |
   | 06 | import-cycle | `bugfix`, `import-cycle` | 8 |
   | 07 | async-race | `bugfix`, `concurrency` | 10 |
   | 08 | api-mismatch | `bugfix` | 8 |
   | 09 | cache-invalidation | `bugfix` | 10 |

   **Dockerfile template** (same for all):
   ```dockerfile
   FROM aiw-base:latest
   COPY workspace/ /work/
   RUN cd /work && git init && git add -A && git commit -m "init"
   ```

   **After each problem:** run `aiw problems check <id>` — must PASS before moving to the next.
   The check verifies the grading pipeline works (patch apply + check.sh).

   **Verify `workspace/` has the bug/gap present** (not the fixed version): the agent solves the
   problem at eval time; workspace is the starting state.

   **Agent brief template** (pass to implementer):
   > Port `experiments/problems/<id>/` from old format to new spec format. Old files are in
   > `experiments/problems/<id>/` (PROBLEM.md, source files). Spec: problems.md §3–4. Reference
   > layout: `experiments/problems/01-chunk-off-by-one/`. Produce: task.json, task.md,
   > workspace/<files>, checks/check.sh, Dockerfile. The workspace must contain the bug/gap
   > (the problem's starting state). check.sh must pass on the FIXED code and fail on the broken
   > workspace (write a quick hidden test if the existing tests don't catch the bug). Confirm with
   > `aiw problems check <id>`.

6. **Done (2026-10-25, run `2026-10-25T12-10-04Z-797d`).** Full compare on 8 reported problems (03-discount-mismatch is `set:dev`, excluded).
   Results (7 problems × 3 modes × 3 reps = 63 jobs):
   | Mode | PASS | FAIL | Rate |
   |------|------|------|------|
   | baseline | 21/21 | 0 | 100% |
   | branch-only | 1/21 | 20 | 5% |
   | orchestrate | 10/21 | 11 | 48% |

   **Anomaly: branch-only near-total failure — root cause found and fixed (2026-10-25).**
   Only `06-import-cycle.branch-only.0` passed; every other branch-only job failed.

   **Investigation** (`02-inventory-feature.branch-only.0`, `events.jsonl`):
   - All branch tool calls returned `ok: true` — the branch runtime itself was fine.
   - Events that look like direct `readFile`/`bash` calls inside branch turns are server-side
     events (s: prefix IDs) emitted when the branch program invokes those tools internally.
     The model was NOT calling them directly.
   - Failure mode: `reason: turn-limit` after 20 turns. The model spent turns re-reading
     the same files and never converging on a fix.

   **Root causes (both fixed in commit `737e492`):**

   1. **Framework instructions missing from system prompt.** `job.ts` called
      `buildSystemPrompt("")` — hardcoded empty string. The branch-only prompt (`branch-only.md`:
      "All work goes through the `branch` tool…") was advertised by the server via MCP
      `instructions` but never read. Fix: `mcp.ts` now calls `client.getInstructions()` after
      connect; `MCPSession.instructions` is populated; `job.ts` passes it to `buildSystemPrompt`.

   2. **Turn limit defaulted to 20.** `cli.ts` passed `turnLimits: {}` so all problems fell
      through to the `?? 20` default in `job.ts`, ignoring `task.json`'s `turnLimit` field.
      Fix: `job.ts` now reads `task.json` directly: `turnLimits[problem] ?? taskJson.turnLimit ?? 20`.

   **Validation run result (2026-10-25, run `2026-10-25T13-13-28Z-1db8`):** 0/3 PASS.
   Both fixes applied; still failing. Investigation continued.

   **Third finding: `valueChars: 200` causes file-reading loops.**
   The branch trace truncates every tool-call result to 200 chars (spec'd in core-branch.md §5,
   `DEFAULT_TRACE_LIMITS`). `inventory.py` is ~450 bytes (~300 chars), so the model sees only
   ~half the file per read attempt. Pattern observed in `02-inventory-feature.branch-only.0`:
   - Turns 1–6: model re-reads inventory.py via different methods (readFile, bash cat, python3)
     trying to get the full content; input tokens grew 400/turn (1538 → 5773 over 12 turns).
   - Turn 7: model attempted `edit({old: '    def get_stock(self, name):', ...})` — hallucinated
     a method name (`get_stock`) not in the file, likely because it never saw the complete
     method list in a single truncated read.
   - Turn 8–11: more reads to get exact content for the correct edit.
   - Turn 12: model called `writeFile` with the full correct rewrite — but grading is intentionally
     skipped on `turn-limit` per spec (§6.1), so the fix was never evaluated.
   - The model did NOT use `state` to cache file content across turns (even with the branch-only
     system prompt now telling it to); this is a prompt-effectiveness gap.

   **The model needs more turns, or better state usage, to solve these problems in branch-only mode.**
   With 12 turns allocated (matching what baseline uses), ~6 turns go to file reading, leaving
   only ~6 for understanding + editing + verifying — not enough for a feature-addition problem.

   **Spec-correct behaviours (not bugs):**
   - `valueChars: 200` is spec-defined (core-branch.md) and a provenance field; changing it
     requires user approval and a spec edit.
   - Grading is skipped on `turn-limit` per framework-runner §6.1.
   - Turn limits per problem are correct; the runner now reads them from `task.json`.

   **Fix chosen (2026-10-25): increase `valueChars` 200→800 (commit `ab119f2`).**
   800 chars covers ~50 lines of Python — all small-problem files fit.
   Spec updated (core-branch.md); server bundle rebuilt.

   **Full compare re-run (2026-10-25, run `2026-10-25T13-52-23Z-3a9f`): run invalid.**
   Two additional bugs fixed during this run:
   - Runner `config.ts` had its own hardcoded `valueChars: 200` separate from core's
     `DEFAULT_TRACE_LIMITS`; provenance showed 200 even after the core fix. Fixed in `11acdcb`
     to import `DEFAULT_TRACE_LIMITS` from `@aiw/core`.
   - Run invalidated mid-way by `job-failed: 07-async-race.orchestrate.0`: HTTP 402 from
     OpenRouter — key hit its spending limit while requesting 131072 max_tokens. Not a code bug.

   **Partial results (14 of 63 jobs, rep 0 only, first 5 problems):**
   branch-only improved substantially — `02-inventory-feature`, `04-vague-rate-limit`,
   `06-import-cycle`, `07-async-race` all PASS in rep 0 (vs. 0/7 before).
   `05-report-refactor.branch-only.0` still FAIL (likely a harder problem for branch).
   `08-api-mismatch.baseline.0` FAIL — unexpected; may be model variance.

   **Remaining branch-only issue: model behavior with the branch paradigm.**
   `05-report-refactor.branch-only.0` failed despite `valueChars=800`. Root causes:

   - **Compile errors (turns 2–3):** model wrote invalid branch syntax (`const file = await
     tools.readFile(...)` instead of `async (tools, state) => { ... }`). Branch compiler
     rejected both; 2 turns wasted recovering. Indicates the model doesn't reliably know the
     required arrow-function wrapper syntax even with the system prompt.

   - **Direct tool calls (turns 9–11):** model called `writeFile` and `bash` outside branch
     (not through the `branch` tool) in 3 consecutive turns. Server returned "Unknown tool".
     Even with the branch-only system prompt, the model reverts to direct calls for file writes.

   Together: 5 of 12 turns wasted on paradigm errors → only 7 effective turns for a
   multi-function refactor. The other 4 problems passed, so these issues are not universal —
   longer / more complex tasks expose them more.

   **P1+P2+P4 done (2026-10-26, commit `41aeae4`):**
   - P1: `branch-only.md` now has a concrete `async (tools, state) => { ... }` code example.
   - P2: explicit rule added — "Never call tool names directly as MCP tools."
   - P4: server returns "Unknown tool X — use the `branch` tool to call it" in branch-only mode.
   - P3 (compile error feedback) deferred; optional arch change.
   - Server bundle must be rebuilt before the next eval run (`node packages/server/build.mjs`).

   **Audit run (2026-10-26, free model `nvidia/nemotron-3-ultra-550b-a55b:free`):**
   Run `2026-10-26T07-09-55Z-b795` on 4 failing problems × branch-only+orchestrate × 1 rep.

   **Bug found and fixed (commit `a65157a`):** Docker bridge network on this machine can't
   resolve external DNS. All orchestrate executor LLM calls were silently timing out —
   `openrouter.ai` DNS lookup failed inside the container. Fix: `--dns 8.8.8.8` added
   to the Docker run for orchestrate containers in `container.ts`. Verified working.

   | Problem | branch-only | orchestrate |
   |---------|-------------|-------------|
   | 05-report-refactor | **PASS** | FAIL turn-limit (executor write didn't persist, planner retried 5×) |
   | 07-async-race | FAIL turn-limit | FAIL turn-limit (same pattern) |
   | 08-api-mismatch | **PASS** | **PASS** |
   | 09-cache-invalidation | FAIL turn-limit | FAIL turn-limit |

   **Detailed failure analysis (2026-10-26):**

   Branch-only efficiency (Nemotron 550B, confirmed by event traces):
   | Job | Max consec. reads | Wasted turns | Outcome |
   |-----|-------------------|--------------|---------|
   | 08-api-mismatch | 2 | 1 | PASS (7T) |
   | 05-report-refactor | 5 | 4 | PASS (10T) |
   | 07-async-race | 5 | 4 | FAIL — correct fix applied in T6, pytest in T10, needed T11 to confirm |
   | 09-cache-invalidation | 5 | 5 | FAIL — correct edit applied in T7, re-read T8–9, findTests T10 (never ran) |

   Root cause of `07-async-race`/`09-cache-invalidation` failures is **re-read loops**,
   not the turn limit itself. Optimal path is 3 turns (read → write → test); these used
   10 with 4–5 spent re-reading the same file before writing. Bumping turnLimit treats
   the symptom; fixing the prompt treats the cause (see P5–P7 below).

   Orchestrate executor failures: Nemotron 550B as executor loops on reads and rarely
   writes (26 reads / 0 writes for `05-report-refactor`; 19 reads / 1 write for
   `07-async-race`). The 4-turn executor cap (see bug B2 below) amplifies this:
   3 reads burn the budget with no room left to write. `08-api-mismatch` passes because
   it is short enough that the executor writes within 3 reads.

   **Done (2026-10-26, commit `e49795f`):**
   - **B1 fixed:** `--secondary-cap` now flows runner→server: `job.ts` passes the flag,
     `cli.ts` parses and forwards to `startServer`, `server.ts` sets `turns` on
     `orchestrateOpts`.
   - **P5/P6/P7 applied:** Three new branch efficiency rules added to `branch-only.md`
     and `executor.md`: single read per file, combine read+write+test in one call,
     no re-reads after write. Updated example in `branch-only.md`.
   - Server bundle rebuilt (`e49795f`).

   **Server bundle is current** as of `73075c5` (includes all prompt improvements
   P1/P2/P4–P11; valueChars 2000; bash example fixed; 298 tests pass).

   **MCP callTool timeout fix (2026-10-26, commit `e0e31a9`):**
   The `@modelcontextprotocol/sdk` default request timeout is 60s. Free-tier models
   can take >60s per turn (nemotron-ultra hit 46s/turn), causing `do` tool calls to
   fail with `MCP error -32001: Request timed out` and invalidate orchestrate runs.
   Fix: `packages/runner/src/mcp.ts` now passes `{ timeout: 300_000 }` to `callTool`.

   **Free-model eval runs (2026-10-26):**
   Three runs across different free OpenRouter models (`branch-only,orchestrate`,
   all 8 reported problems, 1 rep):

   - `nvidia/nemotron-3-ultra-550b-a55b:free` — invalidated by 60s MCP timeout
     (46s/turn; run `2026-10-26T12-34-02Z-c04d`). Partial: nemotron PASS'd 02 and 04
     branch-only before the run died.
   - `poolside/laguna-s-2.1:free`, `poolside/laguna-xs-2.1:free` — both failed on
     turn 2 of every job after 60s (runs `2026-10-26T13-23-56Z-8cc4`,
     `2026-10-26T13-25-24Z-1ed4`). Turn 1 succeeds (7s); turn 2 dies — likely
     per-model rate limiting or OpenRouter-side failure for these models. Unusable.
   - `nvidia/nemotron-3.5-lightning:free` — all 14 jobs ran cleanly (no infra
     errors; avg main latency 2–10s). But **0/14 PASS**: 13× `turn-limit`, 1×
     `checks` (wrong fix). Model is too weak for these coding tasks (run
     `2026-10-26T13-26-50Z-38dd`).

   **Confirmed working after MCP fix:** nemotron-3.5-lightning ran a full
   branch-only+orchestrate pilot without a single infrastructure failure. The
   framework is solid; the gap is model capability.

   **Free model landscape (2026-10-26) — all candidates exhausted:**
   | Model | Status |
   |-------|--------|
   | `qwen/qwen3-235b-a22b:free` | Deprecated Oct 9, 2026 (→ qwen3.7-plus, paid) |
   | `deepseek/deepseek-r1:free` | No longer on OpenRouter |
   | `poolside/laguna-m.1:free` | No longer on OpenRouter |
   | `nvidia/nemotron-3-ultra-550b-a55b:free` | Hit daily RPD cap (2/2 branch-only PASS before limit) |
   | `poolside/laguna-s/xs-2.1:free` | Rate-limited per turn (dies on turn 2), unusable |
   | `nvidia/nemotron-3.5-lightning:free` | 0/14 PASS — too weak |

   **Unblocked (2026-10-27): key raised to $1 budget.**

   **Selective audit (2026-10-27, run `2026-10-27T02-53-30Z-98b9`, $0.021):**
   4 previously-failing problems × branch-only+orchestrate × 1 rep. 7/8 PASS.
   `09-cache-invalidation.branch-only.0` FAIL (turn-limit, same root cause).
   All B1/P-series fixes confirmed working.

   **Full compare (2026-10-27, run `2026-10-27T03-02-23Z-ce5d`, $0.11):**
   All 9 problems × 3 modes × 3 reps = 63 jobs (03-discount-mismatch included).

   | Mode | PASS | Rate | vs. prior full run |
   |------|------|------|--------------------|
   | baseline | 21/21 | 100% | = |
   | branch-only | 8/21 | 38% | ↑ from 5% |
   | orchestrate | 16/21 | 76% | ↑ from 48% |

   | Problem | Baseline | Branch-only | Orchestrate |
   |---------|----------|-------------|-------------|
   | 02-inventory-feature | 3/3 | 3/3 | 3/3 |
   | 04-vague-rate-limit | 3/3 | 2/3 | 3/3 |
   | 05-report-refactor | 3/3 | 1/3 | 3/3 |
   | 06-import-cycle | 3/3 | 2/3 | 1/3 |
   | 07-async-race | 3/3 | 0/3 | 1/3 |
   | 08-api-mismatch | 3/3 | 0/3 | 3/3 |
   | 09-cache-invalidation | 3/3 | 0/3 | 2/3 |

   Baseline perfect; no regressions. Branch-only/orchestrate improved substantially.
   Remaining budget: ~$0.89.

7. **Done (2026-10-27, commit `d7d5c0d`).** Failure analysis + P8/P9 fixes.

   **Root causes found:**

   | Root cause | Jobs affected | New? |
   |-----------|--------------|------|
   | `state.set()/state.get()` silently fail (state is plain object, not Map) | 07-async-race 0/3 | **New** |
   | readFile line-number prefix written to file via writeFile | 08-api-mismatch 0/3 | **New** |
   | Re-read loop (state API failure + no convergence) | 09-cache-invalidation 0/3, 05-report-refactor 0,1 | Known (persists) |
   | Wrong fix (checks fail) | 06-import-cycle.orchestrate.1 | Known |
   | Model variance / tight turn budget | 04-vague-rate-limit 1/3, 06-import-cycle 1/3 | Known |

   **Fixes applied (P8/P9):**
   - `branch-only.md` and `executor.md`: state rule updated — "state is a plain object, not a Map; use `state.key = value` / `state.key`; `state.set()/state.get()` do not work."
   - `branch-only.md` code example: fixed to use `state.src = src.content` (was `state.set("src", ...)`).
   - Both prompts: new rule — "readFile output is line-numbered; strip with `.replace(/^ *\d+\t/gm, "")` before writeFile."
   - Server bundle rebuilt.

   **Remaining failures likely to improve:** 07-async-race, 08-api-mismatch (systematic root causes fixed). 09-cache-invalidation (may improve once state API fixed). 05-report-refactor 0/1 (model variance on complex task).

   **Still open:** 06-import-cycle.orchestrate wrong fix (model variance; no code fix indicated).

   **Validation run (2026-10-27, run `2026-10-27T05-07-13Z-e8ab`, $0.021):** P8/P9 confirmed.
   08-api-mismatch: 2/2 PASS (was 0/3). 07-async-race: 0/2. 09-cache-invalidation: 0/2.

   **New root causes found and fixed (P10/P11, commit `73075c5`):**
   - **P10:** `branch-only.md` code example used `bash({ command: "..." })` — wrong param name
     (bash tool uses `cmd`). Also `test.exitCode`/`test.stdout` → `test.code`/`test.out`. This
     caused verification calls in 07-async-race to silently fail, consuming turns without test
     output, hitting turn limit.
   - **P11:** `DEFAULT_TRACE_LIMITS.valueChars` raised 800 → 2000. `service.py` (09-cache-
     invalidation) is 1355 bytes / 40 lines → ~1475 chars with line-number prefixes. At 800 chars
     the model never saw the `update()` method body, hallucinated the replace string, all replace
     calls failed. 2000 covers all current problem files (largest: test_api.py at ~1666 chars).
     Spec (core-branch.md) and render test updated. Server bundle rebuilt.

   **Validation run (2026-10-27, run `2026-10-27T05-18-25Z-ed96`):** 4/4 PASS on 07+09 branch-only.

   **Full compare in progress** (2026-10-27, run `2026-10-27T05-20-16Z-9216`, all 9 problems ×
   3 modes × 3 reps = 63 jobs). Rep 0 results visible so far: all PASS. Final results pending.

8. User's new orchestrate idea (adds one mode) — not yet presented; it goes through spec approval.
9. After that: optional branch coverage for `coverage` (`sys.monitoring` BRANCH events; tools §6.5, A-35).

Commit spec/README changes as `docs:` commits when the user approves.

---

## Code state

**The codebase has been fully rewritten** in `packages/` from scratch against the architecture specs.
All 6 packages are complete as of 2026-10-25 (298 tests pass, `npm test` at repo root; 2 pre-existing lint failures in `@aiw/tools` are unrelated to runtime):

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
