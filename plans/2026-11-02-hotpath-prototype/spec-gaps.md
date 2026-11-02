# Proposed design gaps — not approved specification edits

## G1: Retrieval/injection bounds

**Kind**: proposal
**Step**: 1
**Case**: Retrieval/injection bounds
**Resolution**: Proposed candidate behavior below; human review remains pending.
**Target spec**: `architecture/orchestrate-engine`, `feature/orchestrate`
**Status**: open

Architecture §4.5 specifies ≤25 lines and approximately twelve seed snippets, but no
injection count or tool-expansion ceiling. Proposed autonomous candidate limits:
maximum two positive-BM25 snippets and six newly added tools in total, including the
existing one-level `requires` completion. Skip a candidate atomically if it exceeds
that limit. Rank by descending description-only BM25, then stable snippet ID.

## G2: Explicit override and unavailable tools

**Kind**: proposal
**Step**: 1
**Case**: Explicit override and unavailable tools
**Resolution**: Proposed candidate behavior below; human review remains pending.
**Target spec**: `architecture/orchestrate-engine`, `feature/orchestrate`
**Status**: open

The interaction with planner `tools` overrides is unspecified. Proposed candidate
policy: no snippets for explicit overrides (including an empty override). Skip a
snippet if any declared tool or its one-level requirement is missing or non-routed.
Do not change the general selection dependency completion algorithm.

## G3: Outcome adaptation to actual APIs

**Kind**: proposal
**Step**: 1
**Case**: Outcome adaptation to actual APIs
**Resolution**: Proposed candidate behavior below; human review remains pending.
**Target spec**: `architecture/orchestrate-engine`, `feature/orchestrate`
**Status**: open

The architecture's stderr-tail example cannot be literal: `bash` returns combined
`{code,out}` only. Summarize that combined tail and classify exits, without pretending
to distinguish stderr. `readFile` returns numbered text, edit errors throw, and rename
reference counts require `findReferences`. Recovery may return fresh context for a
new grounded decision rather than silently guessing an edit, rename, or move.

## G4: Seed inputs and safety

**Kind**: proposal
**Step**: 1
**Case**: Seed inputs and safety
**Resolution**: Proposed candidate behavior below; human review remains pending.
**Target spec**: `architecture/orchestrate-engine`, `feature/orchestrate`
**Status**: open

Snippets are examples to adapt, not auto-executed actions. Each uses documented state
inputs, validates them before tool use, bounds recovery calls, and propagates unrelated
errors. Scope widening stays within the workspace. Never select an ambiguous filename,
blindly set `all:true`, speculate a rename/move, or interpolate paths into shell commands.
Commands, when demonstrated, are explicitly supplied whole commands, not assembled strings.

## G5: Evidence and status

**Kind**: proposal
**Step**: 1
**Case**: Evidence and status
**Resolution**: Proposed candidate behavior below; human review remains pending.
**Target spec**: `architecture/orchestrate-engine`, `feature/orchestrate`
**Status**: open

This candidate tests functionality, not empirical effectiveness. Public practice sources
inform generic filtering and post-edit verification, not benchmark-specific solutions:
- https://www.anthropic.com/research/code-execution-with-mcp
- https://aider.chat/docs/usage/lint-test.html
- https://aider.chat/docs/troubleshooting/edit-errors.html

All assumptions remain proposed. Imported spec bodies and historical inventory anchors
are unchanged; final approval and merge remain human decisions.
