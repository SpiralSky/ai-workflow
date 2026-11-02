---
id: 2026-11-02-selector-reuse
title: "Experimental task-scoped selection decision reuse"
status: draft
specs: ["architecture/orchestrate-engine", "feature/orchestrate"]
---

# Draft experiment plan — human review pending

1. Inspect selection/reference/task lifecycle and research request avoidance versus prompt caching.
2. Prototype explicit single-task opt-in wrapper with fail-closed accounting admission.
3. Compare deterministic repeated/unique/mutated queries offline; verify safety regressions.
4. Parent reviews full test/typecheck/build results; no approval, commit or live evaluation here.

Base: remote PR4 head `67b42ae`; branch `dot/selector-reuse-20261102`.
The user's experimental-branch exception in AGENTS.md permits this isolated development;
this is not a plan/<id> checkout and does not assert plan readiness. `specplane` was not
found on PATH; no CLI status/approval/completion commands were run. Imported spec bodies remain untouched.

No tool-result caching, prompt-cache savings claim, cross-task reuse, paid calls, runner default
changes, fixed60 gate changes, approval, merge or deployment. Evidence and limitations are in
HANDOFF.md, spec-gaps.md and docs/dot-progress/selector-reuse-experiment.md.
