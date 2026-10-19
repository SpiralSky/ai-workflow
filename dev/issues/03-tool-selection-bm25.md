# Issue 03 — Tool Selection: BM25 Shortlist Needs Refinement

**Status:** NEEDS DISCUSSION — do not implement without iterating with user first

## Problem

The current tool selection uses BM25 over tool *description text*, capped at 8
results. This has several weaknesses:

1. **Vocabulary mismatch** — if the task says "fix the circular import" but the
   relevant tool is described as "move symbols between modules", BM25 misses it.
2. **Hard cap of 8** — may exclude tools the secondary needs; no fallback.
3. **No task decomposition** — BM25 runs on the whole task string at once; a
   multi-step task ("find the bug and fix the discount formula") may score well on
   one subtask but poorly on another.
4. **Static index** — the catalog is built once at server start; adding new tools
   requires a restart.

## Open Questions for Discussion

> **AI: bring this up with the user before implementing any changes.**
> Ask:
>
> 1. Should tool selection use semantic/embedding search instead of BM25, or is
>    BM25 + synonym expansion sufficient?
> 2. Should the main LLM be allowed to *request* specific tools by name (rather
>    than letting BM25 decide), falling back to BM25 only when no name is given?
> 3. Should TOP_K be raised (e.g., 12–15), or should there be a two-stage filter
>    (broad BM25 → rerank by task relevance)?
> 4. Should the secondary LLM be able to declare "I need tool X that isn't in
>    my shortlist" and trigger a second BM25 lookup?
> 5. For the tool catalog: how granular should tools be? Should "search codebase
>    for symbol" be one tool, or split into "grep file", "find file by name",
>    "find function definition"?

## Partial Direction (pending discussion)

- Synonym/alias expansion in the BM25 query is a low-effort improvement
- Letting the main LLM pass an explicit `tools: string[]` override on `delegate`
  would give it control when it knows what it needs
- Raising TOP_K to 12 with a lightweight rerank pass costs little
