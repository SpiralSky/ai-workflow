# Direct TypeSafe tool filtering with DeepSeek (experimental)

OpenRouter is **not required** for direct DeepSeek inference plus direct Jev filtering.
Use a separate host-only `TYPESAFE_API_KEY` alongside host-only `DEEPSEEK_API_KEY`.
Neither credential is a CLI argument, repository artifact, task environment or broker field.
TypeSafe requests go only to `https://api.typesafe.ai/v1/systemone`, without redirects,
long-context/image headers, retries or provider fallback. The pinned model is `jev-1.14.0`.

This path complements the supported OpenRouter Decisions candidates;
it does not change the default generic LLM filter or claim Jev wins on our full test set.
Choose this versioned direct route as a reasonable first Jev pilot when avoiding OpenRouter;
compare against the supported Microsoft/Perplexity alternatives before claiming superiority.

Example only, **not authorization to spend**:

```sh
node --import tsx packages/runner/src/cli.ts eval --problems smoke \
  --mode 'orchestrate[rerank=classifier]' --tools S \
  --provider deepseek --usage-mode estimated --model deepseek-flash \
  --max-calls 20 --max-tokens 50000 --max-duration-ms 300000 --estimate-limit-usd 0.10 \
  --classifier-provider typesafe --classifier-model jev-1.14.0 --classifier-threshold 0.8 \
  --classifier-max-calls 10 --classifier-max-tokens 30000 \
  --classifier-max-duration-ms 300000 --classifier-estimate-limit-usd 0.01
```

## Distinct accounting and limits

The four classifier limits are mandatory and shared across the entire campaign, **not reset
per job/attempt**. DeepSeek has its own explicit all-chat-role limits. Both sets serialize
calls and stop future admission at observed thresholds; final responses can overshoot.
Duration cancellation is best effort, not a refund or hard billing cap. Direct TypeSafe
has no off-peak discount requirement; every actual DeepSeek request still enforces its
conservative off-peak policy. No background waiting or automatic paid retry is introduced.

Direct Jev reports billable input and output token counts, **not billed dollars**.
The 2026-11-01 tariff snapshot estimates input at $0.042/million; output is free.
No cache discount is assumed or fabricated. `costUsd` stays absent/null. Model identity
must be observed as the requested pinned version; an unexpected/missing model or token
accounting is terminal, not a zero-cost response.

- Selection turns: `classifierEstimate`, independent of `deepseekEstimate`.
- Run: `classifierEstimatedUsage` and DeepSeek `estimatedUsage` stay separate.
- Task: `estimatedCostComponents` retains both provider subtotals. `estimatedCost` sums
  them only when both are complete, with a composite tariff basis. Baseline tasks correctly
  have zero TypeSafe calls; other jobs' calls are not counted again.
- Report: `meanEstimatedCostUsd` represents the full combined per-task estimate, explicitly
  labeled, never measured cost. Different classifier providers/limits cannot be combined.

Malformed answer sets with valid accounting keep the existing candidate set, record the
estimate, and do not invoke a paid fallback. Missing usage/model, transport/provider failure
or cancellation stops execution before a secondary executor or another main turn.
A parseable failed response preserves known estimated charges; unknown totals retain known
subtotals without pretending they are complete. Dependencies and uncertain-candidate fallback
are unchanged; thresholds are experimental and must be evaluated without tailoring held-out tests.

Mixed ChatGPT subscription plus paid classifier, OpenRouter chat plus direct TypeSafe, and
DeepSeek plus OpenRouter classifier are deliberately refused until a separate explicit mixed
accounting contract exists. The implemented direct pairing is DeepSeek estimated + TypeSafe.

No actual credentials, live inference, billing measurements, full-task success or cost savings
were established by mock testing. Verify the current official tariff before authorizing runs.

Official references checked 2026-11-01:
- https://docs.typesafe.ai/models
- https://docs.typesafe.ai/api/system-one
- https://docs.typesafe.ai/primitives/noul
