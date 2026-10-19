# Issue 06 — No Cross-Call Codebase State

**Status:** NEEDS DISCUSSION — design is open; discuss before implementing

## Problem

Each `orchestrate()` call is stateless. The secondary LLM receives a fresh context
every time with no memory of prior delegate calls. Facts discovered in one call
("function X is in file Y, it has a bug on line 42") must be rediscovered or
manually re-passed by the main LLM in the next delegate's `task` string.

This means:
- Exploration costs are paid again on each delegate call
- The main LLM must manually carry forward discovered facts in its task descriptions
  (it often forgets or omits them)
- Multi-step tasks that naturally decompose ("find the bug" → "fix it") each pay
  the full discovery cost

## Contrast with Baseline

In baseline mode, all file reads and tool results accumulate in the main LLM's
context. The model "remembers" what it found in turn 1 when writing the fix in
turn 3. Orchestrate mode's isolation benefit (small main context) creates this
memory cost.

## Open Questions for Discussion

> **AI: discuss this with the user before designing anything.**
> Ask:
>
> 1. Should the main LLM be responsible for extracting and re-passing state, or
>    should the framework maintain a session-scoped "scratchpad" that persists
>    across delegate calls?
>
> 2. If a scratchpad: what goes in it? Options:
>    - Key-value store: main LLM writes structured facts ("symbol X → file Y:42")
>    - Free-text memo: the orchestrator appends a summary after each call
>    - File-based: a `.branch-tmp/session-state.json` the secondary can read/write
>
> 3. Should the secondary LLM be able to *write* to the scratchpad (e.g., annotate
>    findings for the next call), or only the main LLM?
>
> 4. Is the right fix architectural — e.g., a "two-phase delegate" where call 1
>    is always exploration and call 2 always fixes, with the orchestrator itself
>    managing the handoff — rather than a scratchpad?
>
> 5. Or: should the main LLM prompt be improved to explicitly instruct it to
>    include discovered facts in the next task string (a prompting fix, not an
>    architecture fix)?

## Likely Direction (pending discussion)

A lightweight `.branch-tmp/delegate-memo.md` file that:
- The secondary can read via `readFile(".branch-tmp/delegate-memo.md")`
- The orchestrator appends a one-paragraph summary to after each successful call
- The secondary gets a system prompt note: "check the memo for prior findings"

This requires no API changes and fits the existing branch-program model.
