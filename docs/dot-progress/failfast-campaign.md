# Fail-fast campaign experiment — 2026-11-01

## Authority and branch

User instruction: “Additionally, try to approach testing in the future with saving money in mind, for example once hitting an error, stop all other runs and try to fix the error first.”

The prior user exception permits parallel experimental development without spec approval; approval remains required for final merge. Neither statement authorizes paid model calls here. Plan `2026-11-01-failfast-campaign` was created with the pinned Specplane CLI and remains **draft**. No approve/finish/merge operation was run.

- Branch/worktree: `dot/failfast-campaign-20261101` / `repos/ai-workflow-failfast`.
- Base: integrated `b1190e39d7568040960754d96f325b0edd0f4224`, not the former isolated accounting branch.
- This experimental branch is outside a started plan checkout under the documented development exception; it does not pretend that the draft plan has been approved or started by Specplane.

## Autonomous design decisions

1. Default CLI/resolved concurrency is one. Explicit positive integer parallelism remains possible and records the selected value in run config. Invalid values fail before dispatch.
2. Eliminate the previous two automatic retries. Stop on the first terminal non-pass or error; diagnose and explicitly start a new run rather than silently spending on retries. There is no automatic retry override in this patch.
3. Failure notification aborts siblings before failing-attempt cleanup settles. Undispatched jobs are not fabricated as successes or removed from the target configuration. Run status is invalid, retaining the first causal stop reason. Every launched attempt still settles into accounting; null costs plus known lower bounds are retained. Artifact/observer failures also cancel/drain siblings before surfacing the aggregate error.
4. Carry abort through MCP request options and actual server request signal into host/executor paths. Add the missing selection/rerank signal path, including escalation, and pre-cancel guards. Do not issue another main-model call after a nested-model tool error with uncertain charges.
5. MCP transport exceptions and explicit infra metadata also terminate the loop; ordinary server `isError` tool results remain recoverable unless they can hide nested model charges.
6. Install a scoped container cancellation listener as soon as a container handle exists. Request a best-effort kill, await it and ordinary cleanup, detach the listener. Pre/post setup checks prevent a late model launch after cancellation. Setup Docker build/start commands themselves are not forcibly interrupted because a detached Docker operation can outlive its CLI and lose its cleanup handle.
7. Preserve ordinary recoverable task-tool errors. Fail-fast applies to terminal task failure/infra failure/unknown accounting, not every tool-level negative result. Full benchmark success is still required before any cost ranking; an incomplete fail-fast run is never a successful cheap candidate.

## Known limitations

Cancellation is cooperative/best-effort, not a refund or proof the provider stopped billing. Killing a container during model work makes unobserved usage unknown. Per-attempt budget boundaries and already-started parallel work can still overshoot; strict per-turn/proxy enforcement and live provider reconciliation remain separate prerequisites. No model/API calls, Docker execution, or benchmark cost measurements were performed. Default-concurrency and retry changes intentionally differ from legacy runner prose; see plan spec-gaps.md. Raw archive helpers remain available for historical attempt evidence, but scheduler no longer creates automatic retries.

## Validation

Focused deterministic regressions cover graded failure, infra failure, unknown cost, concurrent cancellation/drain, pre-cleanup notification, no retries, observer failure, unchanged all-pass work, invalid concurrency, cancellable reranking and actual local stdio server cancellation. No fixtures or benchmark targets were weakened.


- `npm test` was attempted; unchanged `tsx` wrapper IPC restrictions still produce `listen EPERM`. Configured `node scripts/test-cloud.mjs` is the supported fallback.
- First full run (`/tmp/aiw-failfast-full.log`) failed the unchanged `renameSymbol: unresolvable uses ...` tools test: reported lines 5 and 8 in addition to expected line14. No tools source/fixtures/assertions were changed. Isolated file rerun passed all24 tests (`/tmp/aiw-failfast-refactor.log`). This is observed intermittent behavior, not a diagnosed or fixed root cause.
- Subsequent full configured run (`/tmp/aiw-failfast-final.log`) passed401 Node tests, root typecheck,20 Python fixture-authoring tests,39 base tests, frozen-matrix/reproducibility checks, and all13 trusted reference diagnostics with5 repeats each. This is not Docker grading or live-model task success.
- A final MCP-transport-vs-recoverable-tool regression was added after that run; latest focused25 tests/typecheck passed. Final integrated snapshot results follow below.
- Specplane validation: valid=true, zero errors; legacy prose lint warnings remain. No spec approval metadata changed.
- Dependency reuse: worktree-local `node_modules/@aiw` links point to this branch's own packages; external dependency links reuse the existing accounting installation. Thus modified core/server code, not stale sibling package sources, is tested. No dependency installation or lockfile changes.

Final snapshot: **402 Node tests passed, zero failures/skips**, root typecheck, all59 Python unit tests, reproducibility/frozen matrix and all13×5 trusted reference diagnostics passed (`/tmp/aiw-failfast-final2.log`). This final execution overlapped the Docker sibling's full suite because the single-lane coordination message arrived after launch; no additional full suites were started afterward. `git diff --check` passed. No measured monetary savings or live-model success is claimed.
