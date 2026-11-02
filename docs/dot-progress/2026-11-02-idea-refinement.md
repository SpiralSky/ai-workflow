# Idea refinement progress — 2026-11-02

User direction: ai-workflow only; keep refining ideas on isolated branches with
references and tests. Tableau and Specplane implementation are paused. Using the
existing Specplane CLI for this repository does not resume framework development.
No plans/specs/decisions approved or finalized; no merges, provider calls, live
campaigns, credentials or paid resources used in this iteration.

## Common base and branches

All candidates start independently from current PR4 source
`67b42ae04153079e84b1fdacdd0082a2e623ffc8`, not from one another. PR1–4 remain
open/draft/unmerged. Protected/default branches were not edited.

| Branch | Local commit | Verified remote commit | Status |
|---|---|---|---|
| dot/design-contract-hardening-20261102 | a572d66d4891a2bcd87f29f20112fc66bcb36494 | bde693c72086a4a7f7676dbf3259c9482b8d524e | Reviewed offline validator correction |
| dot/test-resource-isolation-20261102 | 7bd10f3de551cef18390eee8a69352fc8b2d9dbd | 9cd1381c0ac200c76a42fb0dcc1be891bc7c4767 | Explicit serial test-file scheduling, default unchanged |
| dot/selector-reuse-20261102 | c7255baa50b7b6644c7fb5036264033e97ef299b | 3a0d2cf0c4df25c3c035f4db24904a5ec8299c61 | Opt-in library prototype, not Task/runner wired or promoted |
| dot/hotpath-prototype-20261102 | 7826468308e94add7f668a897a7a74f398c5e117 | c58faeeb966ed1046d2cc73388d647bce9138351 | Reviewed opt-in generic recovery snippets; 696 package +28 script tests |
| dot/idea-refinement-progress-20261102 | This record | Publication tracked separately | Research, comparisons and decision record |

GitHub-created publication commits differ from local commits; exact source trees
were verified before branch creation. Runtime bundle and declaration inventory
were included, not omitted to make publication easier. The source-model/tool
selection defaults remain unchanged in the reuse candidate.

## Reproducible local verification baseline

- Node24.22.1, lockfile-matched installed dependencies copied locally, workspace
  package links bound to each worktree, existing verified Python tool venv.
- Initial dependency symlinks produced different bundle path comments and lacked
  the ignored native runtime closure. Corrected local setup, rebuilt unchanged
  source, then11 focused bundle/native tests passed. No source fix claimed for
  this setup issue.
- A subsequent normal aggregate stopped on the existing runSnippet500ms timeout
  test: timedOut was true but startup stdout was empty. Kept failure evidence and
  stopped expansion. Resource contention is a hypothesis, not proven root cause.
- New test scheduling harness exposes AIW_TEST_CONCURRENCY=1 explicitly; no test
  assertion, product timeout, test inventory, native probe, skip rejection or
  typecheck is relaxed. Unset still uses Node's normal behavior.
- With that same common serial harness, unchanged base passed **598 package +24
  script tests**, zero skips, typecheck and relocated native/tier-L readiness.
  The new harness separately passed16 focused scheduling/failure tests.
- Serial acceptance does not establish parallel stress reliability or model task
  success. Both baseline and candidate use the same declared scheduling policy.

## Candidate evidence and trade-offs

### Frozen design contract

The old checker relied on assert and missed important model/policy/provenance
fields. Parent reproduced invalid input accepted under Python -O. New explicit
strict validation passes10 normal and10 optimized tests, including seven actual
optimized CLI mutation cases, and verifies the frozen external60-cell manifest.
Independent review found JSON numeric-overflow parsing inconsistent with the
nonfinite policy; fixed and retested before commit. All readiness and quality
flags remain false. Original design and specification bodies are unchanged.

### Scoped selector reuse

Full serial candidate: **613 package +29 script tests**, zero skips, typecheck,
exact rebuilt bundle freshness and relocated native readiness pass. Independent
review:59 focused selection/classifier/preservation tests pass. Runtime changes
are recorded as exact development deltas; immutable migration inventories,
original before-states and specification bodies remain intact.

Predeclared synthetic6-query replay: reuse off6 classifier calls, on4, same fixture
selection outputs, four billed turns and two distinct nonbilling hit records.
This is not dollars, cache-token measurement, model quality or full-task success.
No local historical run traces were found to estimate real duplicate frequency.

Task/state/reference/treatment identity, catalog metadata/schema/order and query
inputs control reuse; only accounted nonfallback built-in classifier successes
are admitted. Errors, unknown amounts and aborted requests do not become free
successes. Scope transitions clear stale entries; no concurrent deduplication.
The retained serialized-payload budget is not a hard heap-memory cap.

Conservative Task-store invalidation may erase most real opportunities: startStep
precedes selection, call recording includes findTools, and successful escalation
changes exclusions. Do not wire reuse to stepCount or assume synthetic repetition
represents real usage. Observe exact-key repetition before engine integration.

## References, decisions and next work

See [the comparison](../ideas/2026-11-02-refinement-comparison.md) for primary
ToolRet/OpenAI/Anthropic references and existing-mechanism distinctions. Lazy
tool exposure, recovery, reference passing and BM25 index caching already exist;
they are not new improvements in this work.

The hot-path variant implements a genuinely unfinished specified feature. Its separate
opt-in candidate includes 12 generic bounded seeds, declared tool dependencies,
pre-execution lock integration, compile/mock execution tests and unchanged default
cross-mode comparison. Catalog fingerprints bind hidden snippet text to the treatment.
Full serial verification passed 696 package +28 script tests, no skips, typecheck,
bundle freshness and local native/tier-L probes. Published tree:
`5a70bb4179253fdaf810e408bd144c7ad4cdb622`. No model benefit is measured.

Two additional independent common-base branches passed review and were published:
- `dot/fixture-admission-20261102`: rejects missing/stale checks, unsafe build contexts,
  missing workspaces and failed transport; initial plus five solved repetitions.
  Common serial harness passed 683 package +24 script tests, zero skips/typecheck.
  No real Docker fixture checking was performed locally.
- `dot/dot-native-experiments-20261102`: one-way manual native coding assignment and
  bounded local QuickJS artifact grading. 16 focused tests/typecheck plus a synthetic
  CLI smoke (3/3 checks) passed. No solver pilot, model API adapter or automatic agent
  dispatch. Native-worker billing/quota pool is unknown, not guaranteed dot-only.

These choices are autonomous reversible development decisions, not user approvals.

Full10-task×3-framework×2-tier model success and cost comparison remains unrun.
No candidate is ranked by cost or promoted ahead of that quality gate. Live
provider credentials and a separately bounded spending authorization remain
unresolved; code publication is not spending or authentication permission.

## Additional publication verification

- Fixture admission: local `1039f358dfce62978316c2ee610c38acff331ee7`, remote
  `1efe046a6855b404d956db2490acead0f04f568f`, exact tree
  `12b749fdaf774d1a286e6d340802c7aef16d1d29`.
- Dot-native method: local `f2061ca7971158713b8784699aafbacba5c171d8`, remote
  `6b560f428b0452d4e9710c12156729d8c7cb2995`, exact tree
  `8cca807253b8ad9e5e3d84090e41c2d425dd1618`.
- Independent method review identified input validation before reservation allowed
  same-ID retry after malformed input. Fixed reservation order and added regressions;
  parent reran all 16 tests/typecheck successfully. No native solver pilot ran.
- Run artifacts are ignored. All plans remain draft, branches unmerged.
