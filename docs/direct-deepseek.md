# Direct DeepSeek workflow runs (experimental)

Select `--provider deepseek --usage-mode estimated --model deepseek-flash` explicitly.
OpenRouter remains the default; ChatGPT subscription runs are unchanged. No provider fallback.
Only the current direct Flash identifier is supported. As documented on 2026-11-01 it serves
V4.1-Flash-1017, **not** the retired V4 model. We record requested and provider-returned model
identifiers; these are not independent attestations of model weights.

Supply `DEEPSEEK_API_KEY` in the runner host environment, never a CLI argument, repository file,
task container, or benchmark fixture. The client only contacts
`https://api.deepseek.com/chat/completions`; redirects and endpoint overrides are refused.
All orchestration roles use the pinned host broker; task containers remain network-none.

Example invocation, **not permission to execute a paid run**:

```sh
node --import tsx packages/runner/src/cli.ts eval --problems smoke --mode orchestrate --tools S \
  --provider deepseek --usage-mode estimated --model deepseek-flash \
  --max-calls 20 --max-tokens 50000 --max-duration-ms 300000 --estimate-limit-usd 0.10
```

All four limits are required. Calls are serialized across main, selection and executor roles.
Token and price-estimate thresholds stop **subsequent** calls; a final response can overshoot.
There is no tokenizer reservation or hard dollar cap. Cancellation is best effort and cannot
refund an accepted request. A transport, usage-accounting or terminal task failure stops the
campaign without automatic retry. Ordinary recoverable tool errors remain normal debugging.
Thinking is enabled at high effort; no temperature override is accepted by this CLI because
DeepSeek ignores it in thinking mode. Full `reasoning_content` is replayed for all assistant
turns, including secondary tool calls.

## Off-peak policy

Every request independently checks UTC weekday peak windows 01:00–04:00 and 06:00–10:00.
We conservatively ignore holiday exemptions (never assume an unknown Chinese holiday).
Admission closes five minutes before peaks and opens five minutes after; a request must also
fit its full timeout before the closing boundary. No silent waiting or scheduling occurs.
A timeout cannot guarantee a provider stops computation or which tariff it ultimately bills.

## Cost evidence

DeepSeek token usage is **not measured monetary cost**. `costUsd` remains absent/null.
Cache hits and misses must sum to prompt tokens; missing, invalid or inconsistent accounting
invalidates the run rather than inventing zero. The dated off-peak price snapshot estimates
per-million-token cost at $0.003 cache hit, $0.15 cache miss and $0.60 output. Caching is automatic,
best effort, and actual reported hits are used rather than presumed savings.

Turn telemetry includes separate `deepseekEstimate`; `run.json` includes `estimatedUsage`;
`job.json` contains per-task `estimatedCost`; reports label `meanEstimatedCostUsd` explicitly.
Unknown totals remain unknown with known subtotals retained. Mixed provider/usage mode/limits
are rejected when combining. Estimates exclude tax or other billing adjustments and prices
can change: verify the dated rate table before authorizing a campaign. No live model task
success, measured bill, or cost improvement is established by the mock tests.

Sources checked 2026-11-01:
- https://api-docs.deepseek.com/quick_start/pricing/
- https://api-docs.deepseek.com/guides/thinking_mode/
- https://api-docs.deepseek.com/guides/kv_cache/

Jev/TypeSafe filtering is not enabled by this change. OpenRouter remains available for
existing supported configurations; direct DeepSeek itself does not require it.
