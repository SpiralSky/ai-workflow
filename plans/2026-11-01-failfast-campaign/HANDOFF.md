# HANDOFF — 2026-11-01-failfast-campaign

Plan status stays **draft**. No ready/done/approved/accepted states have been assigned. Work occurred under the user's explicit isolated experimental-development authorization, not an approval fabricated by the agent.

## Implemented experimental scope

`dot/failfast-campaign-20261101`, based on integrated `b1190e39d7568040960754d96f325b0edd0f4224`:

- One-worker default and positive-integer concurrency validation.
- First terminal failure/infra failure cancels/drains current work, stops dispatch and disables automatic retries; run remains invalid with full target config.
- Costs and raw failed/cancelled attempts preserved, including null totals and known lower bounds.
- Failure notification before cleanup; setup abort guards; scoped best-effort container kill and awaited cleanup.
- MCP cancellation connected to server request signal, nested selection/rerank and executor; transport/nested-model failures stop before another main-model call. Ordinary recoverable task-tool errors retain existing semantics.
- Deterministic unit and local stdio regressions. No model/network/Docker calls.

## Evidence and limitations

See `docs/dot-progress/failfast-campaign.md` for validation results, exact logs, an observed intermittent unchanged Python/Jedi test failure, and limits of provider/cleanup cancellation. See `spec-gaps.md` for explicit deviations from legacy concurrency/retry prose.

## Next permitted action

Human/parent review and independent reproduction. Keep full benchmark success as prerequisite to cost ranking. No paid evaluation, automatic retry/resume, spec approval, plan finalization, merge or push is authorized by this record.
