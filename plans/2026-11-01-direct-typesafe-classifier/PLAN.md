---
id: 2026-11-01-direct-typesafe-classifier
title: "Direct TypeSafe tool filtering with explicit mixed estimates"
status: draft
specs: ["architecture/runner","architecture/orchestrate-engine","feature/orchestrate"]
---

# Direct TypeSafe tool filtering with explicit mixed estimates

## Goal

Support direct TypeSafe Jev filtering with direct DeepSeek workflows without OpenRouter,
while retaining truthful separate estimates and complete candidate/task requirements.

## Scope

Pinned fixed-origin typed adapter, host-only independent key, shared campaign classifier
limits, separate usage/estimates, composite per-task/report estimates, conservative fallback,
terminal unknown accounting and representative mock validation.

## Non-goals

Live inference, credential setup, payments, infrastructure, threshold tuning on held-out tasks,
claiming a best model, approvals, finalization, merges or remote publication.

## Specs implemented

| Spec | Coverage |
|------|----------|
| architecture/runner | Experimental mixed estimated provider contract and explicit limits |
| architecture/orchestrate-engine | Direct typed filtering without generic chat fallback |
| feature/orchestrate | Preserve candidate/dependency and task success requirements |

## Acceptance criteria (pending human review)

- [ ] Direct pinned Jev and DeepSeek route without OpenRouter credentials/calls.
- [ ] All classifier usage counts campaign-wide; actual dollars stay unknown.
- [ ] Per-provider and aggregate estimates preserve known subtotal/unknown distinction.
- [ ] Terminal classifier failures stop before executor and next main call.
- [ ] Candidate/dependency behavior, cancellation and report isolation tested with mocks.

## Risks

Tariff snapshots age; token/estimate limits are post-response thresholds, not hard caps.
Provider cancellation may not prevent billing. No model-quality or full-task success claim.

## Steps

1. `direct-typesafe`: implement isolated experimental direct routing/accounting and mocks;
   record observed results while keeping this plan draft.
