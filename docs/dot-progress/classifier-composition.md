# Classifier review composition (in progress)

Branch `dot/classifier-review-20261101` at separate worktree `ai-workflow-classifier-review`,
base `9ed722f2b333a881ae9f3486765dc66ff6042631`. Signin-review remains unchanged.

- Reviewed phase1 source3119aaa8d06242735d4a6cc9540bef4dd841a0e0 replayed as2842cb0.
- Separate fair evaluation design e8fb19d84d65545d2f318dd1c264a52504702848 replayed as314d883.
-29 focused classifier core/adapter/runner source tests passed using mocks; Specplane validation
  passes. This is not final artifact or full-suite verification.
-107 explicit runtime deltas now capture phase1 source before/after hashes. Original immutable
  inventories unchanged. Artifact rebuilding/final delta pending reviewed phase2 composition.
- Phase1's unapproved architecture extension will be moved to a separately linked experimental
  extension document after phase2 replay, restoring original imported spec body exactly. No broad
  spec-hash exception will be introduced. This deliberately prevents snapshot checks from
  claiming original body preservation before that relocation.
- New implementation/evaluation plans remain draft. Potential300-cell design is non-executable,
  no first-spend recommendation; serial mocks then separately authorized smoke/pilot only.

No model/auth/Docker/account calls, secrets setup, publication, approval or merge. No quality,
full-task success or cost improvement measured. Full final gates wait reviewed phase2 source.

## Final phase2 composition

Reviewed phase2 source `18f7aa4c7230f6ff388526c634eb9c38c3198113` replayed cleanly as
`dbc2b31`. Final bundle regenerated from composed source. Source-level feature/evaluation plans
remain draft; implementation choices and resolved TODOs are development decisions, not user approvals.

Restored `docs/specifications/architecture/orchestrate-engine.md` exactly to9ed; the original
19 imported requirement bodies and immutable inventories are unchanged. The experimental section
is now [a separate explicitly unapproved extension](../spec-extensions/typed-classifier-reranker.md),
linked from implementation plan gap records. No exception weakens the original spec-hash checker.
The phase1 source worker's body-hash blocker is therefore resolved by placement, not a baseline reset.

Runtime delta manifest records112 explicit path changes with distinct phase1/phase2 before/after
stages. Shared campaign counters remain shared across jobs, main/secondary and classifier calls;
classifier estimates remain separate, missing usage/unknown billing never becomes zero. No
claim of calibrated probabilities, measured bills, complete model-task success or cost savings.

The separately authored fair evaluation design's implementation-phase prerequisites are now
present in this composition, but its threshold/calibration, exact full-fixture integration and
live campaign authority are still unresolved. Phase1-only notes in that dated design describe
its initial snapshot, not a ban on the now-composed direct-TypeSafe support. Matching primary
providers/models within each block and separating estimates from billed dollars remain mandatory.
Potential300 cells are structural planning material, not first spend or an executable dispatch.

Ignore hygiene/asset trackability, final bundle freshness, strict original-body/runtime preservation
and six offline design invariants with actual frozen external60-cell manifest all pass.
Evidence logs: `/tmp/classifier-composed-{preservation,design}.json`.

Final configured cloud entry: **591 package +22 script tests**, zero failures/skips; root typecheck passed (`/tmp/classifier-composed-full.log`).
Focused final classifier/Decisions/TypeSafe/source broker suites:42 passed
(`/tmp/classifier-composed-focused.log`). Independent reviewer verified all runtime source/test
files byte-identical to reviewed18f7aa4, original architecture body exact9ed, and reported no
remaining bounded privacy/accounting blocker. Distinct campaign gates are not duplicated charge
totals; actual cost remains nullable and estimated components are summed separately.

Target-container validation on earlier hashes remains historical: final classifier composition
still requires its own parent-run Docker probe. No live provider credentials/calls or spending,
remote writes, approval or merge performed in this composition task.
