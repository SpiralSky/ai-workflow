# Typed classifier tool selection (experimental)

## Branch and authorization

`dot/typed-classifier-reranker-20261101` branches from composed
`9ed722f2b333a881ae9f3486765dc66ff6042631`, in `repos/ai-workflow-classifier`.
It is separate from publication and does not modify the immutable evaluation baselines.

The user requested support and recommendations for Jev-like classification models,
including Microsoft's model. Their standing exception permits autonomous experimental
implementation on isolated branches; it does not approve specifications, finalize plans,
or authorize merging. The plan remains draft. No live inference or credentials were used.

## Autonomous decisions and evidence

- Keep existing `llm` default and `none` ablation. Add explicit `orchestrate[rerank=classifier]`.
- Use a typed Decisions adapter, not a chat-output parser. Independent `noul` probabilities
  describe each tool's relevance; this is the official primitive name, not a typo.
- Pin the provider, model, and no-fallback routing on the host. Task containers remain
  network-disabled and receive only nonsecret model/threshold settings. The new reverse MCP
  method shares the closed admission gate, cancellation and replay-ID space with inference.
- Require an explicit threshold in `(0.5, 1]` and policy `noul-v1`. These are experimental
  decision thresholds, not validated model confidence calibration. A threshold suitable for
  one model is not evidence that another model is equally calibrated.
- Reject malformed, missing, extra or out-of-range answers. A malformed answer with valid
  billing, an uncertain probability, or no confident positives keeps the entire retrieval
  candidate list until the existing top-N truncation and dependency completion. No paid
  chat fallback is invoked. Explicit fallback reasons appear in selection stages and
  `classifierSelection` attachments. Valid scores use stable retrieval-order tie breaks.
- Emit exactly one selection turn for each parsed provider result, even a billed malformed
  answer or provider failure. Missing usage remains absent, not fabricated zero. Cost
  accounting reports null totals with known lower bounds when usage or cost is missing.
  Unknown accounting and provider failures stop immediately after telemetry rather than
  allowing further executor calls. Transport loss can still make charges unknowable.
- Turn usage is now optional in telemetry to represent an actual unobserved quantity;
  token rollups mark known sums `incomplete: true`. Older consumers assuming every turn
  has usage need updating. Monetary totals must not treat missing usage as proof of completeness.
- Phase 1 only admits OpenRouter monetary campaigns. Subscription/estimated mixed-provider
  configurations fail preflight. Direct TypeSafe plus direct DeepSeek needs a separate
  per-provider estimate/bounded-call contract; it is a follow-on, not silently routed through
  OpenRouter. A custom chat endpoint is rejected to avoid sending its credentials elsewhere.

## Candidate recommendations (capability-based, not measured quality)

Recommended initial trials: `typesafe/jev-1.14`, `microsoft/microsoft-decision-1`, and
`perplexity/pplx-decider-flash-v1.2`. Other explicitly supported alternatives are
`perplexity/pplx-decider-v1.2`, `scaledown/classify-1`, `upstage/solar-decide`, and
`upstage/solar-decide-flash`. No arbitrary chat model is accepted as a classifier.

Jev is a dedicated structured classifier. Microsoft's stable API model name does not pin
unchanging weights. ScaleDown internally evaluates each question separately and repeats
state, so summed usage can be materially larger than a single shared prompt. Its text-state
compatibility is why this adapter uses `state.text`. No live quality, latency, price or
cost-reduction claim is made. Requested and provider-reported model identifiers are separate
observations; neither proves exact weights.

Primary protocol evidence reviewed 2026-11-01:
- https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request
- https://openrouter.ai/docs/guides/community/jev
- https://docs.typesafe.ai/primitives/noul
- https://docs.scaledown.ai/api-reference/decisions-overview
- https://openrouter.ai/microsoft/microsoft-decision-1
- https://openrouter.ai/perplexity/pplx-decider-flash-v1.2

Example for a future separately authorized monetary campaign (not executed):

```sh
aiw eval --problems smoke --tools S --mode 'orchestrate[rerank=classifier]' \
  --provider openrouter --usage-mode monetary --model deepseek/deepseek-v4-flash \
  --classifier-model typesafe/jev-1.14 --classifier-threshold 0.8 --budget 0.50
```

`0.8` is only an explicit example, not a calibrated recommendation. The per-attempt monetary
budget is not a hard dollar cap; already in-flight billed work may exceed a threshold.
Full task success and unchanged evaluations remain required before cost ranking. Failed or
incomplete fail-fast campaigns cannot be called successful.

## Validation and remaining work

Mock protocol tests cover closed startup admission, overrides, replay, cancellation, pinned
routing, selection fallbacks, dependency completion, and known/unknown accounting. All
451 source tests passed before the final security refinements; final results recorded below.
Generated server assets intentionally await composition/rebuild and authoritative full tests.
No Docker execution, authentication, external API calls, or paid evaluation occurred here.

### Final source evidence

- 456 core/runner/LLM/telemetry tests passed after security refinements, then the additional
  real orchestrate + MCP + main-loop regression passed (5/5 runner classifier tests).
- The added regression proves unknown classifier usage stops before any executor call or
  second main turn, while retaining the classifier's known charge and the main charge.
- Root typecheck passed; Specplane validation reports valid with zero errors (existing warnings).
- Independent security review passed 27 focused tests. Findings addressed: billed provider
  failures, immediate stop on unknown accounting, sanitized pre-cancellation, untrusted
  description encoding, and model-observation mismatch. No live authorization is implied.
- Missing provider model observation also stops after recording charges. An observed ID must
  equal the requested ID or extend it with a hyphenated revision suffix; this checks the
  treatment family, not immutable weights. Cross-family substitution is never used silently.
- First new-test run exposed a fixture-only MCP capability initialization issue; splitting the
  adversarial handshake fixture from the ordinary SDK handshake fixed the test setup. A later
  fixture double-close was removed; neither was represented as a production provider failure.

The generated bundle remains deliberately unchanged on this source-only branch. Parent
composition must rebuild it and run the authoritative full suite before runtime readiness.
