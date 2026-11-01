# Direct TypeSafe classifier — 2026-11-01

Branch/worktree: `dot/direct-typesafe-classifier-20261101`, `repos/ai-workflow-typesafe`.
Base: committed phase1 `3119aaa8d06242735d4a6cc9540bef4dd841a0e0`.
User asked to support and recommend Jev-like models, alongside prior direct DeepSeek request.
Parent accepted the explicit separated-estimates design as an autonomous technical decision,
not plan approval. Plans remain draft; no merge, approval or remote publication here.

## Implemented

Direct fixed TypeSafe endpoint, pinned `jev-1.14.0`, separate host-only key and no OpenRouter
requirement for direct DeepSeek+Jev. Shared phase1 typed validators, bounded responses,
redirect refusal, sanitized cancellation/errors, no retries/paid fallback. Existing candidate
closure and uncertain/malformed answer fallback preserved.

Two explicit campaign gates, not a combined hard dollar budget: DeepSeek's existing limits
and independent classifier call/token/time/estimate limits. Classifier state never resets
per job/attempt. Per-role usage and per-provider estimates remain separate; task aggregate
estimates sum only complete components, retaining known subtotals otherwise. Actual USD
stays unknown. Missing token/model evidence or provider failure stops before executor/next
main call. Parseable billed failures retain known estimate before termination.

## Validation

Final portable package tests: core181 + llm70 + runner203 + server18 + telemetry17 + tools101
+ viewer1 = **591 passed**, zero failures/skips. Typecheck and generated-bundle freshness pass.
Ignore hygiene, diff whitespace, Specplane validation pass (zero errors;257 inherited warnings).
Independent bounded review:44 focused tests passed; no remaining blocking source finding.
Mocks include actual main/selection/executor MCP+QuickJS path, no OpenRouter route, campaign
limits across requests, multi-job component deltas with baseline zero classifier usage,
missing usage/model and billed failure before executor/next main, late cancellation retaining
known subtotal, and incompatible classifier provider/limit report rejection.

No real authentication, secrets accessed, provider/model requests, measured bills, model task
success, or cost reduction claimed. Tariff snapshot dates and overshoot/abort limits documented.

## Composition blocker

The aggregate cloud-entry's17 preservation tests fail at the inherited phase1 authorized spec
body evolution (`architecture/orchestrate-engine`), before checking runtime inventory deltas.
Five other script tests pass. Original migration baselines were not modified. Composition must
explicitly record before/after spec-development and runtime allowances while preserving original
requirements evidence, then rerun the full aggregate entry. Parent/mapper notified. This is
not an aggregate-suite pass or live-Docker/model readiness claim.
