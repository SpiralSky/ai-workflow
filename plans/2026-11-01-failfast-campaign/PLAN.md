---
id: 2026-11-01-failfast-campaign
title: "Stop evaluation campaigns on first terminal failure"
status: draft
specs: ["architecture/runner","feature/framework-runner"]
---

# Stop evaluation campaigns on first terminal failure

## Goal

Preserve the full-task success objective while avoiding additional paid work after a campaign exposes a failure that requires diagnosis. This experimental implementation is authorized by the user's development exception; final merge remains human-controlled.

## Scope

- One-worker CLI default; explicit positive integer parallelism remains available.
- First terminal job failure/infra error stops new dispatch, signals active work and waits for evidence/accounting; no automatic retries.
- Carry cancellation through runner MCP, server, selection/reranking and existing executor/host paths; best-effort container stop.
- Preserve complete costs or unknown totals plus known lower bounds, original target matrix and failure results.

## Non-goals

- Paid evaluation, provider invoice reconciliation, automatic resumption, retry configuration, strict per-turn budget enforcement, or claiming measured savings.
- Treating ordinary recoverable task-tool errors as infrastructure failure or reducing the full benchmark success criterion.

## Specs implemented

| Spec | Coverage |
|------|----------|
| architecture/runner | Scheduling/accounting/cancellation; experimental differences recorded in spec-gaps.md |
| feature/framework-runner | Full target, budget discipline and failure evidence retained |

## Acceptance criteria

- [ ] Default concurrency is one and invalid explicit values are rejected.
- [ ] A failing campaign stops dispatch and attempts cancellation before cleanup settles.
- [ ] No automatic paid retry occurs; observed failed/cancelled costs remain in totals.
- [ ] Incomplete matrices remain invalid; all-pass campaigns retain every required cell.
- [ ] Deterministic mock/stdio cancellation regressions, full cloud tests and typecheck pass.

Acceptance boxes intentionally remain pending human plan review; observed implementation/test evidence is in HANDOFF.md and docs/dot-progress/failfast-campaign.md.

## Risks

1. Cancellation cannot undo provider charges and a killed process may leave usage unknown.
2. Explicit parallelism still permits already-dispatched work to consume resources before cancellation.
3. Setup and teardown may not stop instantly; no Docker integration is available in this environment.

## Steps

1. `failfast`: implement isolated experimental campaign behavior and deterministic tests; record evidence without approving or finalizing this plan.
