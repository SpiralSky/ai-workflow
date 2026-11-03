# Limited cooperative screening preparation

Status: experimental, unmerged. No specification or plan approval is implied.
Base: public checkpoint `6aa8586ca525cce08defafe82bc6cdfc7733c692`, retaining
the shell-safety rebuild `88c9d6a7ebbbe2cd3fbacfe2754de09a1f4e002d`.

## Authorized scope

The user chose limited cooperative screening: private graders and reference answers
are absent during solving, but submitted code may reach them during later grading.
This is not hostile-code isolation and cannot establish that an idea beats baseline.
No isolated runner, paid API usage, Codex task, protected-branch merge or approval is
part of this change. The initial campaign is one representative public fixture,
`calendar-window`, using the direct baseline twice on the same frozen commit.
The pair is predeclared as two single-cell campaigns, with the same public source,
runtime, limits and canary registry. Freeze and audit both submissions before
restoring any grader. This leaves the historical within-campaign prior-review gate
unchanged and avoids grader exposure between solves. Both attempts must be
inspected before expanding the scope. Prior graded success is deliberately not a
cross-campaign gate for this prespecified solve-both-then-grade pair. Unexpected
supervisor, receipt, audit or cleanup errors still stop the second solve. Errors stop
progression; failed attempts are retained rather than replaced or omitted.

## Small admission separation

- `admissionMode: cooperative-screening-v1` is explicit. Missing mode retains the
  historical full source and candidate gates; unknown modes fail.
- Evidence mode remains separate. Native assignments still require existing
  supervisor, READY, bootstrap, action-data, receipt, cleanup and review evidence.
- Public source hashes, executable modes, Git commit and tree are verified at
  admission and later boundaries. The optional hotpath checkout is bound only if
  a cooperative campaign selects that arm. Full admission keeps its prior gate.
- Campaign and cell bind mode, selected arms, source identity, controls, coordinator
  target and the per-cell private-absence attestation. Attestations and same-user
  metadata are procedural evidence, not authentication or access enforcement.
- Private post-submit grading inputs remain outside the public checkout. Exact
  package, script, manifest, public starting workspace and fixture identity are
  bound independently. Additional/missing/changed starting files fail.
- Grading requires a frozen submission and revalidated solve audit. The attempt
  hash is captured before execution; unchanged attempt, source, private package
  and submission are required afterward. Exact grader output is retained and
  revalidated against the recorded outcome. Independent review remains necessary.
- Cooperative `grade.json` contains only an outcome/hash whitelist. Hidden test
  text stays in exact private raw output. Later within-campaign admission requires
  a coordinator-recorded verified private storage version/hash and local raw-output
  absence, in addition to fresh bounded absence evidence. The fixed baseline pair
  needs no grading or private-output restoration between its two solves.

## Canary and available-log audit

The public registry contains marker hashes and scope rules only. Private marker
literals are not in this change. Actual protocol frames stay byte-identical; an
output envelope is separate data, not text appended to a hash-bound relay frame.

The audit reconstructs fixed solver-action, relay-feedback and contiguous host
journal inputs plus every frozen submission file. It rescans exact retained bytes
and compares the complete recomputed report rather than trusting an eligibility
boolean. Missing required evidence, changed hashes, unauthorized/unresolved marker
hits or observed prohibited access prevent progression.

This run's native tool logs remain unavailable; the audit is relay, journal and
submission evidence, not a complete tool-call audit. Candidate subprocess reads are
unobserved. A denied read is an attempted violation, not proof that data was read.
The scanner detects only literal marker bytes in supplied evidence. Marker absence
never establishes absence of contamination. Shared filesystem and shared plugin
access remain possible. The result label is always limited cooperative screening.

## Runtime and validation evidence

The pre-existing installed root dependency closure was copied offline, with no
installation or model call. Its 9,778 files and 29 links have fingerprint
`17a4989d1e57413a3ffb23e3da56e4409d9ca60e99a0d15ec71536558acf11b3` before
copy, after copy and after trusted smoke tests. All seven workspace links resolve
to this checkout. All 269 installed registry package versions match the public
lock. Only seven package tarballs remain cached, so full lock-SRI byte provenance
was not re-established. Stale hidden workspace lock metadata is not authoritative.
Viewer-specific build dependencies are outside the baseline runtime scope.

The trusted native-session suite passed 11/11 tests without actors or private
graders; isolated-vm arithmetic and current-source runtime import checks passed.
A separate actual direct supervisor smoke passed READY, read, submit and clean
closure with the default child flags, zero stderr and no snapshot-flag override.
That check covers the direct path, not explicit isolated-vm engine selection.
The existing offline Python/Pyright environment remains separately pinned.

Final selected public control suite: 199/199 passed, with no failures, cancellations
or skips. Independent final review passed 62 focused tests and four additional
integration probes. Those probes are now durable tests; the actual grader's
incomplete status is also covered.
Focused synthetic controls exercise default-full refusal, explicit cooperative
preparation, mode/source/campaign mutation, missing/extra private-package public
files, audit commitments, changed grading attempts, grading-time mutation, raw
output/outcome mismatch, absent canary evidence and incomplete native receipts.
All synthetic private packages contain toy test code only, not real hidden data.
This is selected coverage, not a full repository test or successful model run.

## Remaining operational gates

Before each actor: verify the exact external code checkpoint, recheck the copied
runtime identity, confirm bounded private-file removal, retain the public canary
commitment and use the fixed READY/data-only stdin path. After each clean solve,
freeze submission and audit available observations. After both baseline solves,
restore private grading inputs, grade and independently review, then back up exact
private output and remove private material before any later actor campaign.
Measured supervisor duration includes setup and coordinator idle time. Tokens,
cache effects, billing and model-only latency remain unknown.
