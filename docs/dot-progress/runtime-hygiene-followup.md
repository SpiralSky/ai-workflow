# Stacked hygiene conflict repair (2026-11-01)

The migration branch and later runtime branches independently added two hygiene
files. Their different additions caused an add/add conflict in draft PR #2.
This reversible repair restores `docs/dot-progress/ignore-hygiene.md` and
`scripts/check-gitignore.sh` byte-for-byte to the migration branch versions.
The original audit record is retained as history, not rewritten as a new scan.

The stronger runtime requirement is not removed: `scripts/check-runtime-gitignore.sh`
first executes the unchanged baseline check (including canonical resources), then
requires the packaged Python sidecar and external fixture to remain tracked.
The authoritative `packages/server/test/bundle.test.ts` suite invokes this helper.
Negative regressions remove each packaged asset and a canonical dependency from a
private temporary Git index, require failure, and confirm the real index is intact.
No sample credentials, provider requests or production files are used.

Identical helper, tests and document bytes are applied to the sign-in, DeepSeek and
classifier development snapshots so repairing the parent does not create a new
conflict in its children. Exact metadata allowances record the changed test and
hygiene bytes; immutable specification and migration inventories are unchanged.
Runtime source and generated server bundles are unchanged. Existing branch history
is retained through ordinary single-parent commits, without merging or rewriting it.

This is an autonomous technical repair under the user's experimental-development
permission, not a specification, plan or PR approval. Plans remain draft. No merge,
force-push, branch deletion, credential setup, live inference or spending is authorized.

## Validation evidence

- Restored baseline file bytes are identical across all three repaired snapshots.
- The same complete workspace/script test inventory passed with test files serialized
  (`--test-concurrency=1`): sign-in 537 package +23 script tests; DeepSeek 551 +23;
  classifier 595 +23. Zero skipped or failed tests in those serialized runs.
- The unchanged default parallel run failed twice in the pre-existing Jedi
  `renameSymbol: unresolvable uses are listed in unsure` assertion. The isolated
  refactor suite passed all 24 tests, and the complete tools suite passed all 101
  tests serially. Assertions and repository test configuration were not weakened.
  This repair does not claim to resolve that separate concurrency-sensitive failure.
- The first freshness check failed because temporary dependency symlinks embedded
  sibling paths in generated comments. Reusing copies of the existing locked
  dependencies restored exact freshness. No dependency download or generated
  artifact edit was used to hide the mismatch.
- Typechecking, bundle freshness, full Specplane preservation (including snapshot-only
  tests without historical refs), baseline and runtime ignore checks passed for each
  repaired snapshot. Negative tests remove assets only from temporary indexes.
- Read-only three-tree analysis reports no conflicts for PR #2 against the migration
  base, PR #3 against repaired PR #2, or PR #4 against repaired PR #3. This is not
  a branch merge or a guarantee about future unrelated edits; recheck remote heads.
