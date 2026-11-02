# Explicit resource-isolated local preflight

## Scope and original failure

Independent experimental branch `dot/test-resource-isolation-20261102` from exact `67b42ae04153079e84b1fdacdd0082a2e623ffc8`; draft plan `2026-11-02-test-resource-isolation`. No production/runtime, fixture grading, assertions, target matrices or product timeouts change.

Parent-reported original aggregate failure (2026-11-02), retained in `/tmp/aiw-resumed-baseline.log`: after fixing local dependency-path/bundle setup and absent packaged native closure using unchanged sources and the same lockfile, `scripts/test-cloud.mjs` stopped in `packages/tools/test/l-test.test.ts`. Exact title: `runSnippet: exception with a trimmed traceback; caps; timeout`; `l-test.test.ts:185` uses `assert.match(slow.stdout, /start/)`. Tools suite: 104 tests, 103 passed, one failed. Its 500 ms timeout case returned `timedOut: true` but empty stdout, where the unchanged assertion expected `start`. Parallel test-file load is a plausible resource-contention cause, not established product diagnosis. The failed run remains a failure; later suites/typecheck are not presumed passed. Earlier setup failure logs at that same path were overwritten; those are parent-reported history, not retained failure logs. After dependency materialization/build, 11 focused server tests passed against unchanged source. The parent also verified that `NODE_OPTIONS` cannot carry Node's `--test-concurrency` flag.

## Usage

From a fully prepared checkout:

```sh
AIW_TEST_CONCURRENCY=1 node scripts/test-cloud.mjs
```

`AIW_TEST_CONCURRENCY` must be a canonical positive decimal safe integer: `1`, `2`, etc. Empty, zero, negative, fractional, signed, whitespace-padded, leading-zero, exponent, and unsafe-integer values fail before venv discovery/cache creation or child execution. Unset preserves the previous Node default. The selected scheduling is printed; each test child receives `--test-concurrency=N` directly, never through `NODE_OPTIONS`. Typecheck gets no test-runner flag.

To run this common harness against an existing prepared baseline/candidate worktree, import its exported `main` and call `main(absolutePreparedRoot)` with the same environment setting. The target root still supplies its own tests, package contents, dependencies and typecheck. Use identical scheduling for every baseline/candidate comparison and disclose it in results.

This controls test-file scheduling only; concurrency deliberately exercised within individual tests is unchanged. Serial scheduling does not guarantee timing on an overloaded machine and does not constitute parallel stress evidence. No test files are filtered out: native and relocated artifact probes still run as part of their existing suites. Venv requirement, zero-skip enforcement, nonzero/process-error enforcement, sequential package fail-fast and final typecheck remain unchanged.

## Focused verification

`node --test --test-reporter=tap scripts/test-cloud.test.mjs`: 16 passed, zero failures/skips. Fake child harness verifies exact executable/argument order in default, serial and custom modes, all discovered fixture test paths, workspace cwd, venv propagation, no `NODE_OPTIONS` injection, final typecheck, invalid-setting rejection before children, and fail-fast on skips/nonzero/signal/spawn-error/missing-or-ambiguous TAP summaries. Fake output is suppressed so it cannot contaminate the enclosing real TAP summary or claim package success.

These tests do not execute package assertions/native probes/typecheck. Full prepared-worktree validation remains the parent's next step; no package suite or live/provider/paid experiment ran in this isolated branch. This is test infrastructure, not claimed product improvement or benchmark success. No commit, approval or merge yet.

Additional checks: both changed scripts pass `node --check`; `git diff --check` passes; Specplane `validate --json` reports `valid: true`, zero errors and warnings in existing specifications. The captured focused TAP at `/tmp/aiw-test-resource-isolation-focused.tap` also passes the unchanged production `assertTestResult` skip gate.

Parent executed this harness against unchanged base67b42ae with explicit serial
file scheduling: 24 script +598 package tests passed, zero skips, typecheck
passed, including actual relocated native/tier-L readiness. Separate focused
harness tests16/16 passed. Node24.22.1, existing verified Python venv, lockfile-
matched locally materialized dependencies. This supports the declared serial
acceptance path; it does not prove the earlier parallel failure's root cause or
parallel stress reliability. No assertion, grading check or product timeout changed.
