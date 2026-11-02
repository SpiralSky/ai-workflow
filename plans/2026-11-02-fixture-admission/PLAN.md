---
id: 2026-11-02-fixture-admission
title: "Strict fixture admission before evaluation work"
status: draft
specs: ["architecture/problems", "architecture/runner", "feature/problems", "feature/framework-runner"]
---

# Strict fixture admission before evaluation work

Experimental development only, authorized by the user's “Keep working on and improving it” ai-workflow-only refinement. Branch `dot/fixture-admission-20261102`, exact source `67b42ae04153079e84b1fdacdd0082a2e623ffc8`. No plan approval, readiness, completion or merge is implied.

## Goal and bounded scope

Refuse invalid fixture baselines before bundle/provider/model/job work. A failing clean base cannot be built; a required missing workspace cannot be silently skipped; missing, malformed, failed, legacy-incompatible or stale self-check evidence cannot admit evaluation. Preserve all task/check requirements and the fixed full-success 10×3×2 matrix. No benchmark import, fabricated stamp, live Docker/provider/model work, spending or savings claim.

## Steps

1. Verify source/spec gates and input identities; record gaps without editing imported requirements.
2. Implement the strict production gates and deterministic external-boundary tests.
3. Hand off exact runtime allowances, focused evidence and remaining composite validation to the parent. Keep this record draft.

## Acceptance criteria for review

- Clean-base failure or unavailable Docker/image rejects before workspace replacement.
- Any selected missing workspace rejects before self-check image/container work.
- Producer and consumer share canonical task identity, with separate validation-input identity for references and clean codebases.
- Failed/repeated/mutated validation cannot preserve or create a passing stamp.
- Evaluation gate precedes expensive static freshness and provider discovery, and the per-job drift gate rechecks admission.
- Fake boundaries exercise real workflow logic; no real benchmark fixture receives synthetic success.
