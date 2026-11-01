# Feature Specifications

This directory contains one file per feature, written in long form before architecture is settled.
Features are implementation-agnostic: they describe what the system does, not how.
Architecture specs (in `../architecture/`) follow from these and resolve the how.

---

## Index

| File | Feature | Status |
|------|---------|--------|
| [branching-framework.md](branching-framework.md) | Branch tool — model writes TS programs instead of tool calls | Final |
| [orchestrate.md](orchestrate.md) | Planner emits intents; tool selection shortlists tools; executor carries them out via branch | Final |
| [references.md](references.md) | `@`-references to steps, saved values and code, resolved by the framework instead of copied | Final |
| [framework-runner.md](framework-runner.md) | Runs any agent framework against a problem; captures cost metrics and task resolution | Final |
| [tools.md](tools.md) | Shared tool catalog in two tiers (S core, L large incl. graph/refactor/test tools) | Final |
| [problems.md](problems.md) | Problem set: folder layout, quality rules, validation; small set trimmed, large problems on a shared codebase | Final |
| [viewer.md](viewer.md) | Browser UI for run groups, framework comparison and message-by-message conversations with branch/orchestrate renderers | Final |
| [harness-integration.md](harness-integration.md) | Core sends inner tool calls to a host (harness natively, runner, or MCP fallback); thin per-harness plugins | Final |

**Status** is kept only in this table (spec headers carry none):

- **Draft:** under review; may change freely.
- **Final:** checked; changes are spec changes and need the user's approval.

## Experimental migration status

The table above preserves historical **Final** evidence at b2e781f83976e6807f341debea216dcc56a6ff5d.
Current Specplane frontmatter is **review**, not a new approval. The user explicitly permits
experimental development without spec approval; final merge still requires user approval.
See `docs/dot-progress/migration-decisions.md` for policy and provenance.
