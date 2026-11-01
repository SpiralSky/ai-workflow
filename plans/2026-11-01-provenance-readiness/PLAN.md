---
id: 2026-11-01-provenance-readiness
title: "Attest actual evaluation runtime inputs before model work"
status: draft
specs: ["architecture/runner","feature/framework-runner"]
---

# Attest actual evaluation runtime inputs before model work

## Goal

Make new evaluation runs describe actual observed inputs instead of empty fingerprint maps, requested runtime names, or guessed model identities. Isolated experimental development is user-authorized; this plan stays draft and final approval/merge stays human-controlled.

## Scope

- Fail-closed static source/configuration/bundle/task preflight before account discovery or model work.
- Observe actual server instructions, tool schema/catalog, hidden prompts, runtime/ABI and container image before each job's first model call.
- Persist pending/observed state; reject drift and incomplete finalization. Grade with the observed immutable image ID.
- Separate requested model identifiers from opaque provider-reported observations in per-turn telemetry.

## Non-goals

Live auth, model requests, Docker execution here, monetary estimation, optimizing model choice, cryptographic remote attestation, enforcing the pre-existing wall-clock limit, or claiming benchmark success.

## Specs implemented

| Spec | Coverage |
|------|----------|
| architecture/runner §9 | Source/problem/runtime/framework/image provenance and limits visibility |
| feature/framework-runner | Reproducible comparison; no invented usage or identity evidence |

## Acceptance criteria

- [ ] Missing or stale static evidence prevents launch.
- [ ] Each launched job observes actual runtime/image identity before any model request.
- [ ] Missing maps cannot produce a completed new run; inconsistent repeated observations are rejected.
- [ ] Hidden check contents and credentials never enter model prompts or provenance output.
- [ ] Requested aliases and provider-observed model identifiers remain distinct.
- [ ] Focused deterministic tests pass; composed artifact is rebuilt and fully validated before live use.

Observed implementation evidence is in HANDOFF.md; boxes remain pending plan review rather than signaling approval.

## Risks

1. Local MCP metadata is unauthenticated self-report matched against a trusted read-only mounted artifact, not adversarial attestation.
2. Source-only branch deliberately leaves generated bundle stale until composite integration rebuilds it.
3. Stable-input assumption: byte snapshots detect ordinary drift, not hostile mutate-and-restore races.

## Steps

1. `provenance`: implement and test source-only isolated changes; hand off exact evidence and rebuild requirements without approving/finalizing this plan.
