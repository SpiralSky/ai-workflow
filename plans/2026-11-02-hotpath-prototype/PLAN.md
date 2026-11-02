---
id: 2026-11-02-hotpath-prototype
title: "Bounded opt-in hot-path snippets"
status: draft
specs: ["architecture/orchestrate-engine","feature/orchestrate"]
---

# Bounded opt-in hot-path snippets

## Goal

Make the unfinished hot-path experiment executable as an explicitly opt-in, bounded
candidate, without assuming that prompt examples improve task success or cost.

## Scope

- Description-only BM25 retrieval of approximately twelve generic recovery snippets.
- Add available declared tools and one-level requirements before execution locking.
- Enable `orchestrate[hotPaths]`; preserve default and fixed60 cross-mode behavior.
- Compile and mock-execute seeds; validate ranking, limits, provenance, and locking.

## Non-goals

No benchmark hints, LLM-backed tools, provider calls, spending, guest/Docker dispatch,
external writes, default promotion, specification approval, plan completion, or merge.
No imported specification bodies are changed.

## Specs implemented

| Spec | Coverage |
| --- | --- |
| feature/orchestrate §9 | Generic opt-in snippet ablation and unchanged comparisons |
| architecture/orchestrate-engine §4.5 | Seed format, BM25 retrieval and mock execution |

## Acceptance criteria (human review pending)

- [ ] Seeds compile and mocked anticipated outcomes, success, and unexpected errors pass.
- [ ] Declared tools, line limits, bounds, stable ranking, dependencies, locks and provenance pass.
- [ ] Default/cross-mode behavior, bundle freshness and composed suite are reviewed.

## Risks

Examples can add irrelevant context or tools. BM25 matching is not semantic relevance.
No quality, speed, or cost improvement is claimed without a separately authorized evaluation.
Proposed bounds and override policy remain autonomous design assumptions (see spec-gaps.md).

## Steps

1. `prototype`: Implement and deterministically validate the isolated candidate.
