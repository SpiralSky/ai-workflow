# Unapproved experimental architecture extension

Development proposal only; original imported architecture requirements remain byte-identical.
Source:3119aaa8d06242735d4a6cc9540bef4dd841a0e0. Applies experimentally to
[orchestrate-engine architecture](../specifications/architecture/orchestrate-engine.md), not an approval.

### Experimental typed classifier extension (2026-11-01, not approved)

The user-authorized optional `rerank=classifier` treatment adds independent typed relevance
probabilities via a host-only Decisions adapter. Existing `llm` and `none` behavior/defaults
remain unchanged. Explicit provider/model, threshold `(0.5, 1]`, and policy `noul-v1` are
recorded in run configuration and runtime provenance. Thresholds are not cross-model calibrated.

A complete valid answer set orders confident positives, with stable retrieval-order ties.
Malformed answers, any uncertain probability, or no positive keeps all retrieved candidates
until the unchanged truncation and dependency completion stages. Record fallback reason and
scores/threshold; no additional paid fallback is allowed. Classification never grants tool
permissions or approves plans. Tool descriptions are untrusted relevance data.

Every parsed response is accounted as one selection turn, including billed malformed answers
and provider failures. Unknown usage is absent, never zero; monetary completeness fails closed.
Provider failures or unknown accounting stop subsequent work immediately after recording known
charges. Transport failures can leave billing unknown. Phase 1 supports OpenRouter monetary
runs only; direct or mixed-provider estimates require their own explicit accounting contract.

## Phase2 implementation note (unapproved)

Direct TypeSafe + DeepSeek estimated mode is implemented separately by source18f7aa4c7230f6ff388526c634eb9c38c3198113.
The phase1 scope above is historical, not a claim that direct estimates are forbidden forever.
See [direct TypeSafe contract](../direct-typesafe-classifier.md) for distinct provider estimates,
shared campaign counters and fail-closed incomplete accounting. No measured bill or savings is claimed.
