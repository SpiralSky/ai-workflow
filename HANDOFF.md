# AI Workflow — Handoff

> **To resume**: read this file, then see the [Roadmap](README.md#roadmap) in the main README for pending work.

---

## Current State (2026-10-18)

Clean eval run completed (`2026-10-18T05-39-00-582Z`), 81 jobs across all three modes × 9 problems × 3 runs:

| Mode | Pass rate | Notes |
|------|-----------|-------|
| baseline | 20/27 (74%) | DeepSeek v3; Claude would score higher |
| branch-only | 12/27 (44%) | Single tool constraint is artificial |
| orchestrate | 17/27 (63%) | Beats branch-only; below baseline |

Viewer data is current — open `experiments/viewer/index.html` after `cd framework && npm run view`.

All older runs archived to `experiments/runs/archive/`.

---

## Architecture

**Orchestrate mode flow:**
1. Main LLM gets `delegate` tool only
2. `delegate` → `orchestrate()` in `framework/src/orchestrator.ts`
3. Secondary LLM writes TypeScript branch programs (helpers: readFile, edit, bash, runTests, etc.)
4. BM25 shortlist selects composite tools; implementations injected before secondary's code
5. `ORCHESTRATE_EXCLUDED` blocks writeFile/patchAndVerify/readAndSummarize from shortlist

**Key constants (as of 2026-10-18):**
- Orchestrator max turns: **15** (was 6) — `orchestrator.ts:18`, override with `BRANCH_ORCHESTRATE_MAX_TURNS`
- Step observation cap: **6000 chars** (was 2000) — `orchestrator.ts:20`
- Main loop turn cap: **40** (default) — configurable via `--turns N`
- Delegate turn cap: **15** (default) — configurable via `--orch-turns N`

**Key files:**
- `framework/src/orchestrator.ts` — orchestrate loop, MAX_TURNS, STEP_CAP
- `framework/prompt/orchestrate-system.md` — secondary LLM system prompt (problem-specific hints)
- `framework/prompt/delegate-tool.md` — main LLM system prompt for orchestrate mode
- `experiments/run.ts` — eval runner, all three modes, metrics, CLI flags
- `experiments/viewer/build-data.mjs` — viewer data builder (reads enriched `.meta.json`)
- `experiments/problems/` — 9 problem workspaces with hidden test dirs

---

## Metrics persisted per job (`.meta.json`)

As of 2026-10-18, every job writes a full meta.json:
```json
{
  "model": "...", "backend": "openai", "mode": "...",
  "pass": true, "status": "ok",
  "turns": 4, "cost": 0.0007, "subCost": 0.0,
  "durationMs": 12000, "inputTok": 1800, "outputTok": 120,
  "cacheRead": 0, "cacheCreate": 0,
  "branchCalls": 0, "delegateCalls": 1, "orchestrateTurns": 3,
  "returnUser": true, "msgChars": 280,
  "failReason": "FAILED: test_chunk (test_chunks.ChunkTest)"
}
```
`failReason` categories: `turn-limit`, `no-edit`, `wrong-edit`, `timeout`, `api-429`, or the first `FAILED:` test line.

---

## Prompt fixes applied (history)

All fixes that made orchestrate mode reliable (2026-10-17/18):
1. `patchAndVerify` exclusion — was causing writeFile loop (secondary called patchAndVerify → writeFile → threw DISABLED)
2. No-prose rule for secondary LLM — was writing English before TypeScript → parse errors
3. Deferred import for p06 (circular import) — never create utils.py, always move import inside method
4. p06 ONLY models.py — secondary was touching both files, breaking services.py
5. p04 rate check ordering — check must happen before `sent.append()`, not after
6. p07 Lock requirement — hidden test uses `inspect.getsource()`, must use threading.Lock literally
7. Main LLM "audit mode" fix — removed policy examples that caused exploration-without-fixing

---

## Next directions

- Analyze `failReason` distribution across modes to identify structural failure patterns
- Investigate p01 (0/3 orchestrate) and p09 (0/3 orchestrate) — new consistent failures in clean run
- Consider: longer `--orch-turns` for hard problems; per-problem turn budget
- Consider: adding more problems to the eval set

---

## Orchestrate redesign — design notes (2026-10-18)

### The fairness problem
~~`orchestrate-system.md` contains per-problem hardcoded hints (deferred import for p06, Lock for p07, rate-check ordering for p04, etc.). These were added incrementally to fix failures. The result: orchestrate doesn't win because of a better tool interface — it wins because it has better prompt engineering. The comparison is contaminated.~~

**RESOLVED (2026-10-19):** Stripped the p04/p06/p07 per-problem hints from `orchestrate-system.md`. Neither mode now has problem-specific hints. **Rerun the eval on p04, p06, p07 (and ideally all problems) to get clean, uncontaminated scores before drawing conclusions.**

### The structural improvement: active coordinator

Current orchestrate architecture:
1. Main LLM gets `delegate` tool only
2. File listing pre-injected into the main LLM's prompt
3. Secondary LLM gets BM25-shortlisted composite tools pre-injected

The pre-injection is passive — the coordinator is handed context it didn't ask for. The cleaner design is **active**: the coordinator uses tools to discover what it needs, just as a human engineer would.

**Proposed coordinator tool set (replace file-listing injection):**
- `list_files` — raw file tree for orientation
- `grep(pattern)` / `find_symbol(name)` — targeted location without reading contents
- `get_structure(path)` — semantic digest of a module: exports, imports, class/function names. No file contents.
- `delegate(task, context)` — hand off a precise subtask with exactly the context the executor needs

No `read_file` for the coordinator. Tool availability is the constraint — if there's no read tool, the coordinator stays high-level without being told to. File contents only appear in the executor's context.

**Why this is better:**
- Coordinator context grows only when it actively searches, not always
- The BM25 shortlist (currently pre-computed) becomes a live `grep` the coordinator calls when it needs it
- No file-listing injection needed — coordinator discovers structure on demand
- `get_structure` gives semantic orientation (exports, imports) without raw content noise

**Executor:** unchanged in concept — secondary LLM with branch programs (or Python equivalent). The context it receives is constructed by the coordinator's `delegate(task, context)` call, not pre-injected.

### Branch-only: Python instead of TypeScript
Branch-only's failures are partly TypeScript cognitive overhead (syntax errors, `returnUser` misuse, import restrictions). The fix is to use Python as the execution language — models are trained on far more Python than custom TypeScript DSLs. Custom helpers map naturally to Python functions or simple bash utilities. The "done vs. continue" signal: no special `returnUser` needed — just check if the model stops calling the tool (no tool call = done).

### Fairness baseline for next experiment
Before running: ensure all three modes have equivalent prompt quality (same level of general guidance, no per-problem hints in any of them). Then compare:
- baseline: standard atomic tool calls
- branch-python: single tool, Python execution language
- orchestrate-active: coordinator with `list_files` / `grep` / `get_structure` / `delegate`, no pre-injection
