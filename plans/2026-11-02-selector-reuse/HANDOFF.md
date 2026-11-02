# Handoff — draft, not approved or finalized

Implementation on `dot/selector-reuse-20261102`, base PR4 `67b42ae`. No commits made.

- Added opt-in task-scoped wrapper and internal classifier accounting admission evidence.
- No runner wiring or default/gate changes. Existing reference passing, lazy exposure, BM25
  index cache and findTools recovery are not reimplemented.
- Focused deterministic comparison: six predeclared queries, six calls off/four on, equal
  selections; two nonbilling hit attachments and four synthetic billed turns.
- Final focused suite: 34/34 passed after reviewer refinements; command recorded in
  docs/dot-progress/selector-reuse-experiment.md. Parent owns final full suite/typecheck/build.
- tsx CLI IPC is blocked by sandbox EPERM; supported `node --import tsx --test ...` works.
- Review gaps G1–G6 before integration. No monetary savings, model-quality or task-success claim.

Parent review refinements: failure attachments contain fixed status only (raw thrown errors
still reach caller); observed revision/treatment transitions clear entries before lookup and
after await; A→B→A cannot revive an observed old partition. Documented serialized payload versus
V8/transient memory distinction. Intermediate focused reuse suite passed 12/12; diff-check passed.

Final independent-review refinements: all calls observe the owned scope even when reuse is
bypassed, and post-await checks apply too. `sourceTreatment` describes configuration/accounting,
not original billed-turn linkage. Valid TypeSafe estimate-only admission and invalid estimate
rejection covered explicitly. Frozen candidate: combined 34/34 passed, including 15 reuse tests;
`git diff --check` passed. Parent owns final full verification/build. No commits made here.

Runtime guard requires actual nonempty strings for task/state/reference/treatment identity;
malformed JavaScript values fail before selector/provider execution. Final focused 34/34 pass.

Preservation integration: parent's initial full candidate check stopped at the expected old
allowance hash mismatch. Added exact reviewed runtime after hashes plus three new before:null
entries, and a separate selector_reuse_followup stage record based on actual PR4 base bytes.
Original inventory bytes/baseline before-states/historical followups and old draft plan list
remain untouched. New runtime/docs/plan/test files staged for tracked snapshot visibility only;
no commit. Additive draft status boundary and separate tamper suite pass with existing guards:
25/25 preservation tests, no skips. Parent owns subsequent full candidate verification.

## 2026-11-02 shared-gate development integration

The later user authorization permits development-branch merges only. The independent candidate
now composes shared parent `7b4980f3806db5ad2a7cf7ba28ab11c303caad08` without hotpath
treatment changes. Full composed verification: 775 Node + 12 normal/12 optimized Python
tests, both typechecks, zero incomplete outcomes. Exact parent identities, conflict decisions,
review fingerprint and evidence are in
`docs/dot-progress/selector-reuse-shared-integration.md`. This supersedes earlier pending-test
notes only; plan remains draft, runtime wiring remains absent, no efficacy/default promotion.

## Corrected native-comparison shared gates

Shared central `972fb81e419b948f0ff5ae9ff128132ae64c7d89` is independently composed into this
candidate, without hotpath runtime source or changed reuse wiring. Focused58 and full805 Node
+24 Python tests pass with all three typechecks and zero incomplete outcomes. Runtime source,
bundle, allowances, inventories and specs remain exact prior candidate bytes. Review and evidence:
`docs/dot-progress/selector-reuse-native-harness-integration.md`. Plan stays draft; publication and
separate native experiment interpretation remain parent-owned. Frozen hotpath HEAD was untouched.
