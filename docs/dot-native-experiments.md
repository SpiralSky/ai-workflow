# Dot-native experiments: one-way assignment and artifact grading

**Experimental method, not a provider.** This adds local preparation and grading for an ordinary,
bounded coding assignment that a coordinator may manually assign to a native dot worker. It does
not use dot as an API, run a prompt queue, route model completions, launch an agent, scrape chats,
read sessions/credentials, or expose a network endpoint. There is no `--provider dot`.

**Quota caveat:** native task assignment does not establish which subscription/deeper-work meter
pays. Dot-only, free, or non-shared quota cannot be verified by this method. Model identity, turns,
tokens, price and quota pool remain `null`, even for a coordinator-declared dot-assisted trial.
Preparation and grading never construct or invoke a model client; that is not a billing guarantee
for the worker.

## Workflow

Run from the repository root with the existing locked dependencies:

```sh
node --import tsx scripts/dot-native/cli.ts prepare ledger-pilot-001
```

This creates a new private directory under ignored `experiments/runs/dot-native/` with
`brief.md`, `fixture.json`, and `manifest.json`. It never overwrites an existing run. The task is
newly authored generic arithmetic, not a copied benchmark/reference solution: read a fake ledger,
sum/count strictly positive values, submit the summary, and return it. Three fixed cases include
mixed values, an empty ledger, and negatives/duplicates.

1. Review the brief and quota caveat. **No live solver trial was authorized or run as part of
   developing this method.** Obtain coordinator authorization for any subsequent trial.
2. Using dot's normal native task-assignment interface, manually assign one fresh worker the
   bounded coding task described in `brief.md`. Do not build automation around per-completion
   dispatch. Send only the generic brief; no private conversation extraction is needed.
3. Review the returned artifact as text. Place its one async-arrow expression in the run's
   `solution.ts`; do not execute shell instructions or import modules from it. The worker should
   not edit the grader, tests, fixture, manifest, or brief. Use a fresh run ID for any new attempt.
4. Grade the artifact locally:

```sh
node --import tsx scripts/dot-native/cli.ts grade ledger-pilot-001 coordinator-declared-dot-assisted
```

For a manually authored/mock artifact, omit the final argument; the default is
`synthetic-contract`. A coordinator label is an assertion, **not verified model provenance**.
After validating the command's evidence label and canonical, existing, non-symlink run directory,
grading exclusively creates `grade.lock` **before reading any preparation inputs, solution, or source
hashes**. Invalid/tampered/missing input, invalid UTF-8, oversized source, compilation/runtime failure,
and interruptions after reservation all consume that run ID. Completed grading writes `report.json`
(including compile/runtime failures); rejected inputs may leave only the lock, without a report. Missing/unsafe/non-directory
run paths and invalid command arguments fail before reservation. Do not overwrite/retry a reserved run. Preserve the failure
and prepare a fresh ID if a new attempt is authorized. Exit code is nonzero on failed checks or
invalid input. No feedback is automatically sent to any worker.

## Execution and safety boundary

- Source goes through the real `@aiw/core` `compileBranch` and `runBranch` with explicitly selected
  QuickJS. It is never evaluated in Node or passed to a shell. Existing production runtime and
  specification bodies are unchanged.
- The only host capabilities are in-memory `readLedger({})` and `submitSummary({total,count})`.
  No filesystem, network, process, credential, model or real project tools reach the artifact.
- Limits: 16 KiB UTF-8 solution, 16 KiB preparation inputs, 1 s/32 MiB per case, four host tool
  attempts, 128 trace events/16 KiB trace, 4 KiB returned output plus state, 32 KiB final report.
  Each successful case must actually read once, submit once with exact expected values, and return
  the exact summary. Actual host observations, not claimed artifact checks, determine success.
- Tool protocol/budget failures are sticky even if source catches them. Unknown tool attempts
  observed in runtime traces fail the case. The helper uses QuickJS's interrupt predicate rather
  than disposing the engine reentrantly from a trace callback. Buffered events may exceed a
  threshold before the next interrupt poll; limits reject the result, not truncate it into success.
  Per-case memory and time limits remain independent backstops. Final output is size-checked after
  the bounded runtime returns; this is not a streaming byte cap on intermediate serialization.
- Fail-fast stops after the first failed case. All three fixed checks must run and pass; compile
  failures and zero checks never pass. Missing checks are not counted as successful.
- CLI inputs are simple run IDs, never arbitrary paths. Reads reject symlink components, final
  symlinks, hardlinked/non-regular/oversized/invalid-UTF-8 files; creation uses exclusive opens.
  Reads loop through short reads to EOF/cap and compare opened identity, byte count, size and
  nanosecond modification/change timestamps before and after reading; ordinary concurrent changes
  fail closed. Preparation inputs must exactly equal their authored canonical bytes, not merely self-reported
  hashes. The optional library `root` parameter exists for trusted tests, not artifact control.
- Run directories must remain exclusively coordinator-owned. Path checks are defense in depth,
  not a sandbox against a concurrent same-user process swapping ancestor directories. QuickJS is
  the project's existing execution boundary, not a new security certification for hostile code.

## Evidence schema and interpretation

`dot-native-report/v1` contains the evidence label, `evidenceVerified: false`, task/runtime,
SHA-256 hashes of solution, fixture, brief, manifest, local method/CLI/runtime source files and
lockfile; fixed limits; checks expected/run; per-case host tool outcomes and trace counts; and
local compile/grading/case elapsed milliseconds. `toolCalls` counts host attempts (including denied calls);
`successfulToolCalls` counts accepted fake-tool outcomes, and `toolBudgetExceeded` marks attempted
overflow without allowing extra tool execution. Raw traces, private chats and secrets are not
written. Timing measures local grading only, not worker thinking, assignment latency or model time.
The source hash map identifies bytes, not a claim that the checkout was committed or clean.

Accounting always preserves unknowns: `model`, `modelTurns`, `inputTokens`, `outputTokens`,
`costUSD`, `quotaPool` are `null`; `billingVerified` is false. `fullFixed60ModelSuccess` and
`savingsMeasured` are always false; `savingsUSD` is null. Fixed generic cases test this contract,
not full-task/generalization quality, production routing, comparative model quality or savings.
Never interpret a successful mock solution as an actual dot-assisted trial. A dot-assisted
artifact is still only a bounded toy trial, not full-fixed60 evidence.

## Focused verification

```sh
node --import tsx --test scripts/dot-native/method.test.ts
node_modules/.bin/tsc --ignoreConfig --noEmit --module nodenext --target es2022 --strict \
  --allowImportingTsExtensions --skipLibCheck --types node \
  scripts/dot-native/method.ts scripts/dot-native/cli.ts scripts/dot-native/method.test.ts
```

Tests are authored synthetic contract checks using the actual compiler/QuickJS, never model calls.
They retain exclusive disposable `/tmp/aiw-dot-*` directories; repository run outputs stay ignored.
No broad suite, native solver pilot, full-fixed60 run, billing validation or production deployment
is implied by these commands.
