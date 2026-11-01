---
id: 2026-11-01-typed-classifier-reranker
title: "Typed classifier tool reranking"
status: draft
specs: ["architecture/orchestrate-engine","feature/orchestrate"]
---

# Typed classifier tool reranking

## Goal

Add an explicit, auditable typed classifier alternative without changing existing defaults
or weakening full-task success requirements.

## Scope

1. Verify official classifier protocols and supported model identities.
2. Implement bounded host-only Decisions transport and typed reranking.
3. Preserve billing, uncertainty, dependency completion and fail-fast behavior.
4. Add deterministic regressions and document fair, separately authorized evaluation.

## Non-goals

No live calls, paid evaluation, default switch, measured quality claim, approval or merge.
Direct TypeSafe + DeepSeek accounting is a separately staged follow-on.

## Specs implemented

| Spec | Coverage |
| --- | --- |
| feature/orchestrate §7 | Typed optional classifier, unchanged retrieval/completion |
| architecture/orchestrate-engine §4 | Experimental additional reranker contract |

## Acceptance criteria (human review pending)

- [ ] Typed protocol and host isolation verified.
- [ ] Fallback, unknown accounting and dependency regressions pass.
- [ ] Composed bundle/full validation and fair evaluation reviewed.

## Risks

Model probability calibration differs; APIs can update model weights; failed requests can
incur unobserved charges; no hard monetary cap. See the decision log for compatibility limits.
