# HANDOFF — fixture admission

Draft experimental work on `dot/fixture-admission-20261102`, source `67b42ae04153079e84b1fdacdd0082a2e623ffc8`. No approval/merge/finalization, commits or external writes.

## Source findings

- `problems/index.ts` swallowed all clean-codebase Docker/test failures and proceeded to replace the workspace.
- `checkProblems` skipped missing workspaces and could return success over an incomplete set. It retained a previous successful stamp after failed rechecks, omitted the required large-problem build step, allowed missing fix-word lint metadata, and wrote grading artifacts into the input fixture tree.
- Evaluation had no self-check reader. Producer's unframed hash included `.dockerignore`; provenance uses framed paths/bytes and excludes it. They were not interchangeable.

## Implementation

Clean-base validation now fails closed before replacement. Self-check preflights all selected workspaces, invalidates prior evidence, runs the build step, uses temporary grading output, stops at the first failed validation, and writes success only after required lint and stable-input verification. It requires one empty-diff failure, an initial solved pass, then five additional stability passes (six solved grades total). This conservative interpretation supersedes the earlier unjustified five-total architecture-precedence note.

Version1 stamps carry canonical `taskHash = problemHash(problemDir)` plus distinct `inputHash` over that hash, the reference tree and (for large problems) the clean codebase tree. Consumer validates schema/success/freshness and required files before bundle freshness or provider work; per-job pre-model verification repeats admission. Legacy stamps are not upgraded or interpreted as new hashes: real checks must be rerun.

No real fixture has been checked or stamped. All external-boundary tests use temporary synthetic fixtures. Full-success requirements remain unchanged; this prevents invalid-baseline work, not evidence of savings or task success.

## Validation

All selected problem IDs/owned real directory ancestors and codebase identifiers are validated before mutation. Traversal/absolute/control/nested identifiers, symlinked ancestors, linked task metadata and generated destination files are rejected. Missing discovery is not success. Temporary outside-root sentinel tests prove no redirected mutation/process activity.

The grader now requires an exact UUID-nonce completion suffix from its check wrapper, matched to the Docker process exit. Infrastructure failures without evidence throw; timeout124 remains a failed grading outcome with `checksCompleted:false`, which cannot validate the required empty-baseline failure. Self-check requires completed checks for empty and solved outcomes. This proves wrapper completion, not integrity of arbitrary test content or security against hostile same-UID/process inspection.


Focused validation passed: `node --import tsx --test packages/runner/test/fixture-admission.test.ts packages/runner/test/provenance.test.ts packages/runner/test/problems-overlay.test.ts packages/runner/test/container-image.test.ts` — 147 passed, zero failed/skipped. `node_modules/.bin/tsc --noEmit -p tsconfig.json` passed. Tests execute only temporary fake Docker/process/grading boundaries, local filesystem/Git fixtures and FIFO rejection; no real Docker/provider/guest/model checks or stamps.

Read-only review identified and fixes cover clean-base mutation during validation/materialization, missing codebase auto-creation/zero-test discovery, and comment/duplicate/malformed fix-word metadata bypasses. Clean-base bytes are hashed before/after checks and copy; actual Docker unittest invocation requires at least one test.

Stamp reading is bounded to 4096 bytes through a no-follow, nonblocking regular-file descriptor; rejects FIFO/symlink/oversize, duplicate decoded keys, unknown fields, invalid UTF-8/JSON and malformed schema. Errors do not echo stamp contents. Broader task-tree hashing remains the existing unbounded trusted-local-input operation, not a hostile same-UID race sandbox.

Parent owns final composed bundle build and full common-serial suite. Runtime allowance after hashes must be refreshed if further runtime changes occur.

An earlier read-only subreview found no remaining blocker within its scope before the final review corrections below; it does not independently validate those later changes. That review ran no additional tests or external operations; it is technical feedback, not approval/finalization. Exact Specplane migration validation also passed using the parent's verified CLI (all 19 imported specs preserved; historical and self-contained inventories verified; draft plan remains non-executable). Parent's final composed artifact/full-suite evidence remains separate.

## Final review corrections

Exact generated build-context policy is validated separately from the unchanged canonical taskHash. `buildImage` itself and self-check/eval admission require the shared generator bytes `*\n!workspace/\n`, read via a bounded no-follow/nonblocking regular-file descriptor. Missing/tampered policy and any `Dockerfile.dockerignore` override fail before image/provider work. Tests include hidden reference/check sentinels, changed ignored bytes after a valid synthetic stamp, missing/same-length tampered/oversized/link/FIFO/directory policies, and overriding policy. These are contract/fake-boundary checks, not real Docker context execution.

Stability now includes the initial solved grade and five subsequent repetitions. A regression fails specifically on the fifth repetition and confirms no stamp is produced. Focused 147 tests passed, zero failed/skipped; typecheck and exact Specplane migration/preservation validation also passed after these corrections. No real checks/stamps or imported-spec edits.

## Parent-owned common serial suite evidence

Independently inspected `/tmp/aiw-fixture-admission-full.log`: script tests 24; package counts core 181, llm 70, runner 288, server 22, telemetry 17, tools 104, viewer 1 — **683 package tests and 707 total tests**, all eight summaries with zero failures/skips. Log confirms test-file concurrency 1 and successful final typecheck. SHA256: `7c3bc30ef845d0f9d47549a8c5ef0327a9d2e7f28dc5f30e31c156bf00b041c9`. This was the parent's execution, not a second child broad run.

See `docs/dot-progress/fixture-admission.md` for exact focused commands, detailed counts, local evidence hashes and caveats. Parent reports final independent delta review found no blockers; no commit, readiness/approval/completion status or real fixture success is inferred from these tests.

The exact common-serial command and separate harness provenance are now recorded in the progress document. Local harness HEAD/tree/script hash were independently verified; the parent's remote transport-commit statement is explicitly labeled parent-reported rather than reverified remotely. No runtime edits or commits were made during this evidence-only update.
