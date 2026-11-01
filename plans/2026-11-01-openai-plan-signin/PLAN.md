---
id: 2026-11-01-openai-plan-signin
title: "Sign in with ChatGPT for workflow runs"
status: draft
specs: ["architecture/runner", "architecture/framework-server", "architecture/system-overview", "feature/framework-runner"]
---

# Sign in with ChatGPT for workflow runs

Experimental development is authorized by the user's explicit request to add OpenAI sign-in, and earlier permission to develop parallel candidates without approving specifications. Final approval and merge remain human-only.

## Scope

1. Public-client OAuth sign-in, verified identity and plan scope, protected per-registration credentials and serialized refresh.
2. Public Responses streaming provider; full custom orchestrator history/tools and model discovery; OpenRouter default preserved.
3. Host-side credential isolation through reverse stdio MCP for secondary agents; bounded explicit subscription-usage campaigns, unknown monetary costs preserved.
4. Mock-only authentication, transport, streaming and workflow tests. No actual registration, login, model requests or paid calls in this development task.

## Acceptance criteria (pending human review)

- [ ] Explicit deliberate sign-in, account selection and model discovery; tokens never enter task containers or logs.
- [ ] Full main and secondary workflow routing, cancellation and fail-fast preserved.
- [ ] Namespace tools and stateless Responses history; only terminal completed inference succeeds.
- [ ] Quota mode has explicit call/token/time bounds and no automatic paid fallback.
- [ ] Mock regressions and existing portable tests pass; limitations are documented.

## Steps

1. Implement and test auth, provider and orchestration integration; retain this plan as draft.
