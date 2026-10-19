# Issue 04 — Framing Mechanism: Dynamic LLM Call vs. System-Prompt Injection

**Status:** NEEDS DISCUSSION — user has a different mental model; clarify before touching

## Current Implementation

When the secondary LLM exhausts MAX_TURNS without calling `returnUser`, or when
framing is needed, `orchestrator.ts` makes an extra LLM call (`frameReport`) using
`MODELS.weak` to summarize the step observations into a report. This is a runtime
LLM call that costs tokens and adds latency on the failure path.

## User's Mental Model (from conversation)

> "I'm not sure how framing works as implemented but I imagined it as being injected
> into or below the system prompt based on current toolset, not dynamically altered."

This suggests the user expects framing to be **static prompt text** — instructions
shaped by which tools are active, injected once at session start — rather than a
dynamic summarization call made mid-run.

## Open Questions for Discussion

> **AI: discuss this with the user before changing anything.**
> Ask:
>
> 1. By "framing injected based on current toolset" — do you mean the secondary's
>    system prompt should change based on which tools were BM25-selected? For example,
>    if `runTests` is in the shortlist, the system prompt says "always run runTests
>    before returnUser"; if it's not, it doesn't?
>
> 2. The current `frameReport` call only triggers on the *failure path* (max turns
>    exceeded, no returnUser reached). Is the goal to eliminate that fallback call
>    entirely, or to change the happy-path framing?
>
> 3. Should "framing" refer to the instructions shaping *how the secondary writes
>    its final report* (style, what to include), or something different — e.g., a
>    preamble injected into the main LLM's context to set expectations?
>
> 4. If tool-shaped system prompt injection is the goal: should the catalog entries
>    carry their own "framing snippets" (e.g., a `frameHint` field), and the
>    orchestrator concatenates the relevant ones into the system prompt before the
>    loop starts?

## Likely Direction (pending clarification)

If the goal is tool-shaped system prompts: add a `frameHint?: string` field to
catalog entries and concatenate non-empty hints below the base system prompt when
those tools appear in the shortlist. This replaces the dynamic `frameReport` call
with static, composable prompt text — cheaper and more predictable.
