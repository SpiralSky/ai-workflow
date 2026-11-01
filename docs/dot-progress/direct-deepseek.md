# Direct DeepSeek experimental implementation — 2026-11-01

- Branch/worktree: `dot/direct-deepseek-20261101`, `repos/ai-workflow-deepseek`.
- Base: composed `179ac108`; reviewed host-only broker `12cbb388` replayed as `05dad7c`.
- User request: add direct DeepSeek; future calls off-peak. Experimental development permission
  is not spec/plan approval, paid-run permission or final merge approval.
- Implemented: explicit `deepseek`/`estimated`, only `deepseek-flash`, fixed official endpoint,
  no redirects/fallback, host-only key, complete reasoning history, per-request off-peak+timeout
  admission, strict cache hit/miss/output accounting and serialized all-role thresholds.
- Actual USD remains unknown. Dated per-turn, per-task, run and report estimates are separate.
  Estimates/token thresholds are post-response, not hard caps; cancellation is not a refund.
- OpenRouter defaults and ChatGPT behavior retained. Jev not enabled or removed.

## Verification

Final portable package test files via `node --import tsx --test --test-reporter=tap`:
core172, llm51, runner187, server18, telemetry17, tools101, viewer1 = **547 passed**,
zero failures/skips. TypeScript passes. Generated server bundle rebuilt and its freshness
regression passes. Ignore hygiene and `git diff --check` pass. Specplane validation valid,
zero errors, 257 inherited advisory warnings. Independent bounded security review found no
remaining blocking source issue after cancellation/broker/optional-report corrections.
All API tests use injected mock transport/clock. Main loop tool turn and in-memory
main/selection/secondary orchestration tested, with per-role estimates and reasoning replay.
No real credentials accessed, live API/model requests, monetary cost or benchmark improvement.

`npm test` could not launch tsx CLI IPC sockets (EPERM); portable loader ran the same package
files without IPC. Initial tests found optional estimate-property compatibility and test
assertion/syntax defects; corrected and rerun. Server initially rejected stale artifact/missing
venv; artifact rebuilt and verified existing baseline tools venv supplied. No tests weakened.

## Integration blocker

The aggregate cloud-entry script's seven migration preservation tests fail until explicit
before/after development allowances include hostbroker and DeepSeek additions/changed hashes.
Immutable original migration baselines were deliberately NOT overwritten. The composition
owner must update the authorized delta manifest and rerun the full aggregate entry before
publication. This is not a full aggregate-suite pass or live-Docker/model readiness claim.
Plan stays draft; final human approval/merge outstanding.
