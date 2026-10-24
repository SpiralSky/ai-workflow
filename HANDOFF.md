# AI Workflow — Handoff

> **To resume**: read this file, then see the [Roadmap](README.md#roadmap) in the main README for pending work.

---

## Spec review in progress (2026-10-24): `docs/specifications/review-handoff.md`

Working through the review in small batches; each item is labelled with its source spec (feature/architecture + §).

**Resolved this session (uncommitted):**
- F2 → new `exec` effect (feature: tools §6.5, orchestrate §6); only `read` counts as read-only.
- F1 + F3 → branch programs run in a fresh `isolated-vm@6.2.0` isolate behind `IsolateRuntime` (QuickJS-WASM fallback);
  timeout/abort disposes it (stops sync loops, model sees a failed result); only JSON crosses the boundary;
  state snapshot per tool call, reverted after a kill (`stateReverted`). Feature: branching-framework §4.1/4.4/5.2/5.4/6.1,
  harness-integration §1; architecture: core-branch §1–4.1 (I-11). Container stays the outer boundary.
- README related-work: Anthropic's programmatic tool calling noted as similar but developed independently.

**Things to consider (prior-art check vs Anthropic, 2026-10-24):**
- Nearly every part already exists at Anthropic: code mode (Programmatic Tool Calling), on-demand tool retrieval
  (Tool Search Tool), hot paths ≈ Skills, context isolation via subagents. Reported results (frontier models, internal
  evals): tool search 85% fewer definition tokens, accuracy Opus 4.5 79.5→88.1%; PTC 37% fewer tokens, GIA 46.5→51.2%.
- Orchestrate's real differences: (1) the planner has no tools and works only in intents; (2) the framework, not the
  executing model, picks and orders tools per intent; (3) intent-sizing rules incl. conditional intents. Branch's: the
  line-level trace shown to the model (Anthropic shows only logged/returned output) — test it as a hypothesis.
- State the claim precisely: Aider's architect is also tool-free; the difference is a tool-free planner directing
  tool-using executors whose tools the framework selects.
- Anthropic keeps tools in the lead because delegation costs tokens/latency and reports are lossy. Orchestrate bets
  against that; `resolve`, conditional intents and the re-read / planner-vs-executor token metrics (orchestrate §10.1)
  must show which cost dominates if it loses. Coding steps are interdependent (Anthropic: weaker fit for multi-agent).
- DONE (specced): orchestrate §2/§2.1 states the goal (cheaper actions via a large purpose-built catalog) and the
  comparison to Tool Search (worst case = tool search via `findTools`); §10.2 adds the catalog-size scaling experiment
  (`catalog=N` padding, `branch-only[toolSearch]` baseline); README related-work has Anthropic rows. Budget ties to F5.
- Anthropic's numbers are frontier-model results; results on deepseek-v4-flash are an open gap worth reporting.
- Consider rewriting branching-framework §1–2 to cite prior art and frame branch as the code-mode baseline/executor.

**Next:** user has a new orchestrate idea (adds one mode) to discuss; then review batch §2 (F4–F8).
Commit spec/README changes as `docs:` commits when the user approves.

---

## Code state: `framework/core/branch/`

`branch.ts` (+ `framework/test/core-branch.test.ts`, uncommitted) is an early in-process runner from 2026-10-21. It
predates the architecture specs and does not match them (no isolate, instrumentation, recorder, `state` or renderers).
Rebuild it per architecture/core-branch.md rather than patching it; the old `src/runner.ts` path is replaced afterwards.
Workflow: main session designs, Sonnet subagents execute, small steps.
