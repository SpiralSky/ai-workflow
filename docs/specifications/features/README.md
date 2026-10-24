# Feature Specifications

This directory contains one file per feature, written in long form before architecture is settled.
Features are implementation-agnostic: they describe what the system does, not how.
Architecture specs (in `../architecture/`) follow from these and resolve the how.

---

## Index

| File | Feature | Status |
|------|---------|--------|
| [branching-framework.md](branching-framework.md) | Branch tool — model writes TS programs instead of tool calls | Draft |
| [orchestrate.md](orchestrate.md) | Planner emits intents; tool selection shortlists tools; executor carries them out via branch | Draft |
| [references.md](references.md) | `@`-references to steps, saved values and code, resolved by the framework instead of copied | Draft |
| [framework-runner.md](framework-runner.md) | Runs any agent framework against a problem; captures cost metrics and task resolution | Draft |
| [tools.md](tools.md) | Shared tool catalog in two tiers (S core, L large incl. graph/refactor/test tools) | Draft |
| [problems.md](problems.md) | Problem set: folder layout, quality rules, validation; small set trimmed, large problems on a shared codebase | Draft |
| [viewer.md](viewer.md) | Browser UI for run groups, framework comparison and message-by-message conversations with branch/orchestrate renderers | Draft |
| [harness-integration.md](harness-integration.md) | Core sends inner tool calls to a host (harness natively, runner, or MCP fallback); thin per-harness plugins | Draft |

**Status** is kept only in this table (spec headers carry none):

- **Draft:** under review; may change freely.
- **Final:** checked; changes are spec changes and need the user's approval.
