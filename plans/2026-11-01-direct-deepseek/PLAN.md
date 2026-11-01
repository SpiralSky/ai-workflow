---
id: 2026-11-01-direct-deepseek
title: "Direct DeepSeek provider with bounded estimates"
status: draft
specs: ["architecture/runner","architecture/framework-server","feature/framework-runner"]
---

# Direct DeepSeek provider with bounded estimates

## Goal

Add explicit direct DeepSeek inference without OpenRouter, preserving host credential isolation,
complete task requirements, thinking tool protocol and honest cost evidence.

## Scope

- Fixed direct Flash client with conservative per-call off-peak policy and cancellation.
- Explicit bounded estimated mode across main, selection and secondary roles.
- Separate cached-token price estimates and measured-dollar report fields.
- Mock transport and representative tool workflow tests.

## Non-goals

Live inference, payments, credential setup, model-quality claims, enabling Jev, merge or approval.

## Specs implemented

| Spec | Coverage |
|------|----------|
| architecture/runner | Experimental provider and usage-mode integration; see spec-gaps.md |
| architecture/framework-server | Credential-free host broker preserves complete responses |
| feature/framework-runner | Explicit bounded campaign configuration and distinct cost evidence |

## Acceptance criteria (pending human review)

- [ ] Host-only credentials and fixed official origin; no provider fallback.
- [ ] Main and secondary reasoning history, cache usage, cancellation and fail-fast tested.
- [ ] Every request gated by conservative off-peak schedule; all roles share limits.
- [ ] Estimates never become measured dollars and unknown accounting stops further work.
- [ ] Representative mock workflow and portable regression tests recorded.

## Risks

Tariff snapshots may age; provider computation/billing may continue after abort. Post-response
limits are not hard token or monetary caps. No live provider success is implied by mocks.

## Steps

1. `provider`: implement and test direct transport and bounded workflow integration in this isolated experimental branch; keep plan draft.
