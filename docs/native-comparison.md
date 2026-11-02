# Matched native-artifact comparison (experimental)

This helper prepares **two tasks × hotpath snippets off/on**, four ordinary one-way assignments,
with 45 fixed diagnostic cases and 52 fixed located-line cases. It is not a provider, completion endpoint, agent
launcher, full orchestrate benchmark, or fixed60 model campaign. It never invokes a model client.
The coordinator manually dispatches fresh native workers only after reviewing a committed harness
and candidate. Preparation launches **zero** assignments. Do not use a CLI/API, internal endpoint,
session extraction, credentials or hidden model transport to dispatch workers.

## Frozen design

- `diagnostic-record`: compact check/error-neighborhood record, clean versus incomplete evidence.
- `located-line-record`: literal matching lines; missing-file relocation only with unique,
  untruncated, safe search evidence.
- Task wording and public contracts in `scripts/native-comparison/tasks.ts` are independently
  authored adaptation tasks, not benchmark references. Freeze them before observing workers;
  do not retune weak retrieval matches or hints after results.
- Cell order is diagnostic **off, on**, then located-line **on, off** (AB/BA). One artifact per
  cell, no feedback/repair round or best-of selection; retain every failed/incomplete cell.
- Both arms receive identical public contracts, fake host capabilities, cases and budgets.
  The on arm adds exact snippets returned by the actual reviewed `HotPathIndex.select` against
  those already available tools. No tools may be added/reordered. Retrieval ranking is not copied
  or reimplemented here. The local pilot tests presentation/adaptation only, not integrated
  tool expansion, full planning, recovery trajectories, or named model quality.
- There are 97 checks planned per arm (194 across the four artifacts). Execution fails fast within an artifact:
  later checks are **unrun**, not passed. A compile failure runs zero checks and fails the task.
  Safe-refusal records can pass their corresponding contract cases; they do not imply task
  success on arbitrary real projects. The inventory samples every explicit result/error/validation branch and key boundaries, not every
  possible input. The located-line no-mutations clause also rejects persistent state changes. Correct unexpected-error
  propagation is a passing case only after all expected
  host calls occurred and QuickJS returned the exact expected thrown-error message. Throwing a
  matching string without those calls or returning a fabricated record cannot pass.
- Synthetic references exist only for local grader regression tests. Do not show those files,
  grader fixtures, another cell's artifact, earlier results or feedback to assignment workers.
  Prompt-only isolation is procedural: workers may share an executor. No technical secrecy,
  independent model identity, randomization, statistical power or leakage-proof claim is made.

## Reviewed source and trust boundary

`catalog.ts` admits only the canonical sibling `ai-workflow-hotpath-prototype`, clean before/after
load. HEAD history must contain a commit with exact reviewed tree
`5c048e2715be4dc93bc9b0bcfa354b85f971bc85`. Local and published commit metadata may differ: no
unpublished local commit object is required. The coordinator-supplied canonical published reference
`d75555eecef2249d3fbf5d04902d4133f039fc15` is informational, not a substitute for tree/history checks.
Before import, every relevant source tree, package manifest, lockfile and server bundle must match
the reviewed Git tree/blob bytes exactly; working bytes are read independently of Git status flags.
A doc/harness-only descendant is allowed, not ancestry or object presence alone. Record
`reviewedSourceTree`, informational `reviewedPublishedCommit`, and actual `observedCheckoutCommit`
separately. The observed checkout is frozen per prepared manifest and must not change during a pilot.
The explicit CLI argument must be exactly the approved absolute sibling path; another root, arbitrary
module path, run artifact, symlink or noncanonical spelling is rejected. A fresh full-history clone
at the approved sibling path can use the published tree history without any local-only objects.
Relevant source changes need a newly reviewed tree/version, not silently reused evidence.

Loading this known source executes its reviewed index and normal local dependencies in Node.
Coordinator ownership and an unchanged, already installed dependency tree are prerequisites:
source hashing is not dependency attestation or a hostile same-user filesystem sandbox. Unknown
artifact code is only parsed by the real compiler and executed in **QuickJS**, never imported or
evaluated in Node, shell, or a repository tool. Fake hosts return in-memory fixtures and never
operate on actual projects. The measured public task payload is exactly `brief.md`. Additional common coordinator instructions,
task metadata and native runtime context are outside this proxy; do not store private coordination
in briefs, artifacts or repository documentation.

## Local commands (after review/commit)

From this harness checkout, use the already materialized lockfile dependencies; do not install:

```sh
CATALOG="$(cd ../ai-workflow-hotpath-prototype && pwd -P)"
node --import tsx --test --test-reporter=tap scripts/native-comparison/catalog.integration.test.ts
node --import tsx scripts/native-comparison/cli.ts preflight "$CATALOG"
node --import tsx scripts/native-comparison/cli.ts prepare PILOT_ID "$CATALOG"
```

The outputs are ignored at `experiments/runs/native-comparison/PILOT_ID/`. Inspect `manifest.json`
and dispatch each `brief.md` verbatim in manifest order with a fresh native assignment and no
inherited task/solution context. Copy the worker's exact returned text to its `solution.ts`; do not
repair syntax, remove fences or otherwise curate it. Capture full visible source even when wrong.
Manually grade each submitted artifact once:

```sh
node --import tsx scripts/native-comparison/cli.ts grade PILOT_ID CELL_ID "$CATALOG" coordinator-declared-dot-assisted
node --import tsx scripts/native-comparison/cli.ts summarize PILOT_ID "$CATALOG"
```

Default evidence kind is `synthetic-contract`. The coordinator-declared label remains **unverified**;
it does not prove model identity, native usage, paying quota or billing. All accounting fields are
null, not zero. Use a new run ID for any repaired protocol/version; preserve the previous directory.
No command launches a native worker. No actual pilot has been run while implementing this helper.

Before preparation/dispatch and before grading, a common empty QuickJS isolate is created and
disposed without loading artifact code, installing a bridge or exposing tools. This infrastructure
preflight has a separate **10,000 ms** deadline; its elapsed time is recorded separately from artifact
grading in `engine-preflight.json` and reports. The per-case artifact deadline remains **1000 ms**
after this common engine preparation; production `runBranch` is unchanged. Node timers reject
asynchronous setup overruns; synchronous construction overruns are detected on return, not forcibly
preempted. Late asynchronous construction is still disposed. Setup failure is an infrastructure
error and blocks dispatch/grades, not a task-failure result. If grading has already reserved a cell,
that reservation remains consumed without a report; do not silently retry or call it a model failure.

An exclusive `grade.lock` is created after validating existing run/cell directories but **before**
reading the candidate, manifest, brief or solution. Missing, malformed, oversized, invalid-UTF8,
changed or rejected input consumes the cell even if corrected later. Such admission failures may
leave only the reservation, with summary status `reserved-without-report`; runtime/compile failures
retain their reports. Unsafe/nonexistent directories and invalid IDs are rejected before reservation.
Exclusive output writes never overwrite earlier attempts. Instrumentation events are observed telemetry, not an immutable adversarial trace: artifact code
can mutate isolate intrinsics/recorder state. Accepted fake-host calls are independently observed,
and no forbidden real host capability exists; memory/time limits still apply.

Source/artifact reads reject symlinks,
hardlinks and special files, use no-follow/nonblocking opens, and verify stable descriptor/path
identity and bounded complete UTF-8 bytes. No claim protects against hostile coherent same-user
rewrites of all evidence or invisible native context.

Summaries require matching hashes, original briefs, reservations, fixed case identity/counts,
consistent ordered host observations, full pass coverage and unchanged unknown accounting. They
reject toggled success, fabricated zero-check success and inconsistent reports; JSON is not signed
native provenance. Missing/failed cells remain in the four-cell denominator. A summary is not a
second worker attempt and does not choose a best retry.

## Relative visible-payload proxy only

Count exact public task-brief/source-artifact **UTF-8 bytes**, not tokens or complete model input.
Any common coordinator instructions and task metadata are explicitly excluded, alongside hidden
runtime context. Apply the same coordination procedure to both arms; do not publish its private text. The first assignment per arm is cold.
For each later assignment, hypothetically cache only its longest exact visible prefix shared with
an earlier same-arm brief (whole Unicode code points). Hidden prefixes, cross-arm reuse, actual
cache eligibility/hits/invalidation and model behavior remain unknown.

Report nine normalized scenarios: output-byte weights **1, 4, 8** and repeated-prefix weights
**1, 0.5, 0.1**. They are sensitivity assumptions, **not model prices**. Only four complete,
same-evidence-kind, fully passing artifacts permit on/off payload ratios and ranking sensitivity.
Partial observed payload counts remain visible with explicit coverage but are not a ranking.
Common coordination/task metadata, hidden input/reasoning, native turns, unobserved tool traffic,
model/token price and local-compute
price are excluded. Do not infer actual savings, quota usage, a free/dot-only pool, or model equality.

## Verification and aggregate gate

```sh
node --import tsx --test --test-reporter=tap scripts/native-comparison/method.test.ts
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --module nodenext --target es2022 --strict \
  --allowImportingTsExtensions --skipLibCheck --types node scripts/native-comparison/*.ts
node --test --test-reporter=tap scripts/test-cloud.test.mjs
```

Portable unit/lifecycle regressions use an explicitly authored `synthetic-contract-fixture` catalog,
not copied production ranking or actual hotpath evidence. The synthetic factory only grades as
`synthetic-contract`; real CLI operations cannot admit its manifest. `scripts/test-cloud.mjs`
explicitly runs these nested tests and their standalone strict typecheck, because package
tsconfig/test globs do not discover them. Basic framework CI does not need a sibling candidate.

The separate `catalog.integration.test.ts` and `preflight` commands above are additional mandatory
campaign gates before any pilot. They require the approved clean source-equivalent sibling with its local
dependencies/built server bundle; missing prerequisites fail, never skip or fall back to an
arbitrary code root. Real prepare/grade/summarize independently repeat that admission. All prior
gates/assertions remain required. The coordinator owns the full serial aggregate slot.
Focused checks are not the full aggregate or native model efficacy. See the progress record for
actual completed commands and evidence.

## Fixed v2 contract-branch inventory

The original six-case proposal was expanded **before any native assignment**, following review;
no native result was discarded or task wording retuned. Both arms always use the exact same cases.

| Contract area | Diagnostic (45 cases total) | Located-line (52 cases total) |
|---|---|---|
| Input validation | Fourteen invalid path type/shape/boundary examples; valid 256-character and non-ASCII-directory paths | Same path classes; empty/nonstring/null/81-character terms and valid 80-character term |
| Complete/incomplete evidence | Warnings-only and empty clean; hidden positive errors with/without truncation; zero/absent count with truncation | Absent/ambiguous search; truncation overrides zero/one/multiple visible candidates |
| Safe locations | First error after warning; reject unsafe first location without choosing a later one; twelve invalid returned string paths; noninteger/out-of-range lines; valid 1 and 1,000,000 line boundaries | Unique relocation; twelve invalid returned string paths; safe but wrong basename rejected before read |
| Output contracts | Exact metadata/nulls, own error location, ±2 bounded window, 120-character message and 240-character context | Literal/case-sensitive matches, zero/exactly-three/omitted matches, 160-character line cap, marker exclusion and embedded-marker distinction |
| Error propagation | Check and diagnostic read errors | Non-ENOENT and non-standalone lookalikes; search failure; second-read ENOENT propagates without retry |

Public contract text remains unchanged. `checksSHA256`, source hashes and v2 schema/protocol bind
this inventory; previously prepared synthetic v1 directories are retained, not migrated/reused.
