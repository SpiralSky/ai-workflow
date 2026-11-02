# Dot-native method progress — 2026-11-02

Independent unpublished experimental branch `dot/dot-native-experiments-20261102`, base `67b42ae`.
Implemented one-way prepare/manual-native-assignment/grade workflow with the real branch compiler
and QuickJS. Only fixed in-memory fake ledger tools; no model/provider/agent/network routing.
Three generic authored cases; strict host-observed checks, fail-fast, resource/path/input guards,
hashed evidence, synthetic versus coordinator-declared trial labeling, unknown accounting nulls.

First focused run exposed a too-short cold-WASM timeout and unsafe reentrant trace-callback
abort in the helper. Corrected locally to a 1-second limit and runtime interrupt predicate;
production compiler/runtime modules remained unchanged. The second focused test run passed
11/11 with no QuickJS warnings. A focused type-check initially omitted Node types, then caught
one CLI narrowing issue; corrected before final verification.

Final verification is recorded below. No native solver trial, broad suite, model spend or billing
verification occurred. No commit, publication, approval or merge. Full-fixed60 success and savings
remain false/unmeasured. See `docs/dot-native-experiments.md` and plan gaps for limitations.

## Final focused verification

- `node --import tsx --test scripts/dot-native/method.test.ts`: 12/12 passed after adding the
  parallel over-budget regression; rerun after final CLI narrowing correction.
- Focused `tsc` command documented in `docs/dot-native-experiments.md`: passed with explicit
  `--types node` and validated literal evidence-kind selection.
- CLI prepare/grade smoke: malformed synthetic source correctly yielded nonzero exit,
  `passed: false`, `checksRun: 0`, `checksExpected: 3`, and null accounting. Its report is ignored
  under `experiments/runs/dot-native/contract-smoke-20261102T1144`; not committed.
- Verified source Specplane `validate --json`: valid, no errors; warnings include historical
  specification/detail and instruction-freshness warnings plus plan-index freshness. No automatic
  init/generate or original-spec rewriting was performed.
- `git diff --check`: passed. All implementation/doc/plan files remain uncommitted for review.
- Final file-safety hardening also rejects non-regular artifacts before open and uses a nonblocking
  no-follow read, so a FIFO cannot hang the initial open. Directory-artifact regression added;
  12/12 tests and focused type-check passed again. New-file whitespace checks passed separately.

## Review follow-up: stable bounded reads

Parent review identified that one descriptor read need not consume an entire regular file.
The reader now loops to EOF/cap, compares opened device/inode and regular-file metadata against
pre-open lstat, then verifies byte count, size, nanosecond mtime/ctime, link count and mode against
post-read descriptor metadata and checks the pathname still matches. Nonblocking/no-follow open
remains in place. This detects ordinary read races, not hostile same-UID mutation guarantees.
Deterministic mocked short-read/UTF-8, early EOF, overflow, identity and metadata-change tests added.
Focused tests now pass **14/14**, and focused TypeScript check passes. Documentation now says
preparation/grading never construct or invoke a model client rather than making a transitive-code
absence claim. Accounting schema unchanged; no native solver trial or publication.

## Parent verification

- Independently reran all 14 focused tests: passed, zero skips; strict focused TypeScript check passed.
- CLI prepare and grade with an explicitly synthetic authored solution: all 3 required cases passed.
  Run ID `parent-contract-20261102T1159`; report remains ignored, verified with `git check-ignore`.
- Accounting retained null model/tokens/cost/quota and `billingVerified: false`.
- No native solver pilot or full-suite/model campaign was run.

## Review follow-up: single-attempt reservation boundary

Independent review found that rejected input preceded reservation, allowing correction/reuse of
one run ID. Reservation now occurs immediately after validating the canonical existing run
directory, before reading fixture, manifest, brief, solution or source hashes. Invalid UTF-8,
oversized/missing/tampered inputs, and compile/runtime failures consume the reserved ID; correcting
input still returns EEXIST. Unsafe/missing/non-directory paths fail before reservation. Documentation
states that rejected input may leave only the lock, with no report. Tests cover corrected reattempts
and unsafe-directory behavior. Focused tests now **16/16**, with focused type-check passing.

Parent reran the final 16-test suite and strict type-check after the reservation correction: passed, zero skips. Parent reviewed the lock boundary; the independent reviewer’s sole blocker is addressed. This development commit keeps the plan draft and does not authorize a solver pilot or establish quota accounting.
