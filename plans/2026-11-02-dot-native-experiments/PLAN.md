---
id: 2026-11-02-dot-native-experiments
title: "One-way dot-native experiment method"
status: draft
specs: ["feature/branching-framework","architecture/core-branch"]
---

# One-way dot-native experiment method

## Goal

Provide an ordinary native-worker assignment method with local, bounded artifact grading, without
turning dot into a programmatic model provider or asserting unverified quota accounting.

## Scope

Independent experimental helper, fixed generic case brief, focused regression tests and evidence
schema. Implement on `dot/dot-native-experiments-20261102` based on `67b42ae`; preserve runtime/specs.
User request: "Alright, set up a method for you to run tests in dot using dot's quota."
The coordinator explicitly clarified that native features can be used but the paying quota pool
cannot be verified. Existing experimental-development authorization permits this isolated draft.

## Non-goals

Provider adapters, prompt queues/RPC, chat extraction, credentials/internal endpoints, model-client
or agent launching, billing bypass, live solver trials during implementation, full-fixed60 quality
or savings claims, production routing, commits/publication/merge without review.

## Specs implemented

| Spec | Coverage |
|------|----------|
| feature/branching-framework | Reuses async-arrow program contract and isolated tool semantics |
| architecture/core-branch | Reuses compiler, runBranch and explicit QuickJS runtime unchanged |

## Acceptance criteria (draft; not approval)

- [ ] One-way preparation, separate authorized native assignment, bounded local grading.
- [ ] Real runtime, fixed fake tools/checks, fail-fast, no zero-check success.
- [ ] Hash provenance and explicit unknown cost/quota; synthetic versus declared-trial labels.
- [ ] Path/tampering/size/tool/budget/timeout regressions and focused type-check.
- [ ] Review before any native pilot; no automatic inference routing or production changes.

## Risks

1. Native worker billing/model provenance is unavailable; labels cannot establish it.
2. Buffered runtime events and output serialization are bounded by runtime memory/time before
   host-side byte validation; not a separate hostile-filesystem security boundary.
3. A tiny exposed fixture is not an evaluation of full-fixed60 task success or savings.

## Steps

1. `method`: implement and synthetically verify independent helper on the experimental checkout.
2. `review`: inspect evidence schema, constraints and remaining gaps; do not promote plan status.
3. `pilot`: only if separately authorized, manually assign one fresh native worker and grade its
   artifact. This step remains unrun; never infer permission from preparation or mock checks.
