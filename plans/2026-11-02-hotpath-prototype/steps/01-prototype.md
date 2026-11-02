---
plan: 2026-11-02-hotpath-prototype
step: 1
title: "Implement and deterministically validate the isolated candidate"
status: pending
context:
  - spec: architecture/orchestrate-engine
  - spec: feature/orchestrate
---

## Goal

Implement the bounded opt-in candidate under the experimental development exception,
without implying approval or a completed plan step.

## Acceptance criteria

- [ ] Deterministic seed, retrieval, tool dependency, lock and provenance regressions pass.
- [ ] Exact preservation, bundle freshness and composed checks are reviewed.

## Tasks

1. Implement the isolated candidate and record autonomous gaps.
2. Run authored mock-only checks; retain all original assertions.
3. Keep this plan draft and human-only final merge authority intact.
