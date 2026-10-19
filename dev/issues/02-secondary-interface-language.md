# Issue 02 — Secondary LLM Interface: Program Language Choice

**Status:** Design decision made; monitor for reliability  
**Priority:** Low (current approach works; Python alternative exists if needed)

## Background

The secondary LLM writes TypeScript programs (async function bodies) that run in a
Node.js VM via `runBranch`. This gives it compositional power — it can call 2–3
helpers in sequence when no single tool covers a task — without requiring a
pre-built tool for every combination.

The alternative raised: use Python instead, since many coding tasks involve Python
files and the secondary would feel more at home there. Python is also the language
of most problem workspaces in the current eval.

## Current Trade-offs

**TypeScript programs (current):**
- Runs natively in the same Node.js process as the framework
- Helpers are already implemented in TypeScript
- Secondary LLM must know TS syntax; prose-before-code errors are a real failure mode
  (addressed via prompting, but fragile)

**Python as secondary interface:**
- More natural for Python-heavy workspaces
- Would require a separate subprocess execution model
- Helpers would need Python bindings or a translation layer
- Adds a language boundary at every helper call

## Design Decision

The "write programs" approach is intentional and kept. It enables composing
multiple tools per turn without a bloated tool database. The language (TS vs Python)
is an implementation detail.

## If reliability degrades further

If the TypeScript parse-error failure rate rises above ~15% of orchestrate turns,
revisit:
- Moving to a simpler "one tool call per turn" model (no programs)
- Or a Python subprocess runner with `exec()` and pre-imported helpers

Track via `failReason` in meta.json: look for `"not-code"` or parse-error patterns.
