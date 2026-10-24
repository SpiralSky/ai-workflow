# AI Workflow — Handoff

> **To resume**: read this file, then see the [Roadmap](README.md#roadmap) in the main README for pending work.

---

## Spec review in progress: `docs/specifications/review-handoff.md`

Working through the review in small batches; each item is labelled with its source spec (feature/architecture + §).
F1–F3 are resolved and committed (in the specs). The Anthropic comparison is in orchestrate §2.1 and §10.2 and in the README.

**Open prior-art follow-ups:**
- Orchestrate bets that delegation cost (tokens, latency, lossy reports) is outweighed by cheaper actions. `resolve`,
  conditional intents and the re-read / planner-vs-executor token metrics (orchestrate §10.1) must show which cost
  dominates. Coding steps are interdependent (Anthropic: weaker fit for multi-agent).
- Branch's line-level trace (Anthropic PTC shows only logged/returned output) is a hypothesis to test.
- Anthropic's numbers are frontier-model results; results on deepseek-v4-flash are an open gap worth reporting.
- Consider rewriting branching-framework §1–2 to cite prior art and frame branch as the code-mode baseline/executor.

**Next:** user has a new orchestrate idea (adds one mode) to discuss; then review batch §2 (F4–F8; F5 budget now also
covers the §10.2 scaling grid).
Commit spec/README changes as `docs:` commits when the user approves.

---

## Code state: `framework/core/branch/`

`branch.ts` (+ `framework/test/core-branch.test.ts`, uncommitted) is an early in-process runner from 2026-10-21. It
predates the architecture specs and does not match them (no isolate, instrumentation, recorder, `state` or renderers).
Rebuild it per architecture/core-branch.md rather than patching it; the old `src/runner.ts` path is replaced afterwards.
Workflow: main session designs, Sonnet subagents execute, small steps.
