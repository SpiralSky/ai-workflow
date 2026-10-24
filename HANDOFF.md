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

F4–F5 resolved (commit 64ae458): dev set + temporary 90% failure gate, permanent setup gate, pilot runs,
one-time $1 full run; tuning to pass the gate is a spec change needing approval (minor fixes excepted, overfitting
checked twice). Cost estimate with caching: full rep ≈ $0.5–1 (large problems are the unknown; pilot runs measure it).

**Next:** user's new orchestrate idea (adds one mode) is still pending. Review continues at F6–F7 (already presented,
awaiting decision: F6 hot paths confound → `hotPaths` off in comparisons or `branch-only[hotPaths]` variant; F7 power →
full run detects only large effects, use paired comparisons, pre-state the claim threshold). Then F8–F20.
Commit spec/README changes as `docs:` commits when the user approves.

---

## Code state: `framework/core/branch/`

`branch.ts` (+ `framework/test/core-branch.test.ts`, uncommitted) is an early in-process runner from 2026-10-21. It
predates the architecture specs and does not match them (no isolate, instrumentation, recorder, `state` or renderers).
Rebuild it per architecture/core-branch.md rather than patching it; the old `src/runner.ts` path is replaced afterwards.
When the `packages/` layout (A-02) lands, update CLAUDE.md's `cd framework && npm test`.
Workflow: main session designs, Sonnet subagents execute, small steps.
