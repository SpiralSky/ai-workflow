---
id: 2026-11-01-all-provider-host-broker
title: "Keep orchestration credentials and inference on the host"
status: draft
specs: ["architecture/runner","feature/framework-runner"]
---

# Keep orchestration credentials and inference on the host

## Goal

Remove the confirmed credential boundary defect in runner-owned OpenRouter task containers without changing provider defaults, generation treatment or accounting. Experimental development is authorized; approval and final merge remain human-controlled.

## Scope

- Every orchestrate variant uses the existing host reverse-model broker and network-none task container.
- Container launch construction never accepts a credential/endpoint argument; Docker MCP subprocess descriptors exclude provider secrets/endpoints.
- Preserve host-pinned provider/model and existing secondary settings, admission, cancellation, replay/fail-fast and cost/cache telemetry.
- Sanitize main OpenRouter provider/transport diagnostics before they can enter errors/artifacts.

## Non-goals

Live API/auth/model calls, paid fallback, a new credential scope, model selection, exact-provider-output equivalence, or claiming a hard monetary cap. Standalone server API mode remains an explicitly configured compatibility interface, not a runner container path.

## Specs implemented

| Spec | Coverage |
|------|----------|
| architecture/runner | Isolated task execution, host-controlled inference and accounting |
| feature/framework-runner | Existing provider treatment preserved; fail-fast and no invented costs |

## Acceptance criteria

- [ ] No provider sentinel key/endpoint in task launch descriptors, metadata or error artifacts.
- [ ] Mock OpenRouter workflow succeeds over real in-memory MCP with once-only monetary/cache accounting.
- [ ] Early requests/overrides are rejected; cancellation reaches pending mocked HTTP work.
- [ ] Source tests/typecheck and independent security review pass; final integration rebuilds the affected server artifact.

Implementation evidence is recorded in HANDOFF.md. This draft is not approved or finalized.

## Risks

1. Per-attempt budget enforcement can still overshoot; cancellation does not refund charges.
2. Moving HTTP execution to the host changes network origin by design, not inference generation settings.
3. Generic diagnostics intentionally omit provider error detail that might contain secrets.

## Steps

1. `host-boundary`: implement minimal source correction, test offline, request independent security review and hand off for composite rebuild/full validation.
