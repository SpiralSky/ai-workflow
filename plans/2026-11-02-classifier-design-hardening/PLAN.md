---
id: 2026-11-02-classifier-design-hardening
title: "Fail-closed offline classifier comparison contract"
status: draft
specs: ["feature/orchestrate","feature/framework-runner","architecture/orchestrate-engine","architecture/runner"]
---

# Fail-closed offline classifier comparison contract

## Goal

Harden the existing draft comparison checker without changing the comparison design or claiming campaign readiness.

## Scope

Explicit optimization-safe validation, exact frozen identities/settings/provenance, strict JSON and bounded files, optional frozen fixture-manifest verification, and offline adversarial regressions.

## Non-goals

Provider/model calls, credentials, package/runtime changes, fixture copying/execution, thresholds or benchmark changes, approvals, finalization, commits before parent review, publishing or merging.

## Specs implemented

| Spec | Coverage |
|------|----------|
| architecture/orchestrate-engine | Preserve K20, N6 and existing completion semantics |
| architecture/runner | Preserve provenance distinctions; not a run configuration |
| feature/orchestrate, feature/framework-runner | Fixed full task matrix and honest comparison boundaries |

## Acceptance criteria (not approved)

- [ ] No assertions used for input validation; invalid input rejected under Python -O.
- [ ] Exact existing five arms, policy, completion, fixed-across-arms declarations and source/hash pins.
- [ ] Strict types/keys, exact unique 60-cell matrix, bounded strict JSON and normalized errors.
- [ ] Optional manifest digest/schema checks and path containment; never certify live readiness.
- [ ] Draft records and original specification/design content preserved.

## Risks

1. This intentionally frozen contract requires a reviewed checker update for a new design revision.
2. Manifest digest verification attests bytes, not execution, checked-out source identity, or actual fixture contents.
3. Local fixture roots must be stable during validation; this is not an adversarial concurrent filesystem sandbox.

## Steps

1. `harden`: implement and test the bounded checker on the authorized isolated experimental branch; keep plan draft.
2. `review`: parent/human review evidence and limitations; do not finalize or merge.
