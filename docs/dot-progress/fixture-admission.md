# Fixture admission — experimental validation evidence

Date: 2026-11-02. Branch: `dot/fixture-admission-20261102`. Exact source base: `67b42ae04153079e84b1fdacdd0082a2e623ffc8`.

Development remains draft and unapproved. This records implementation/test evidence, not plan completion, human approval, fixture correctness, campaign readiness, benchmark success or savings. No commit, real model/provider request, real Docker check or real fixture stamp was produced by this work.

## Implemented scope

- Clean codebase validation is mandatory; absent/empty tests, Docker failures or source drift cannot silently authorize workspace materialization.
- All selected owned problem/codebase paths are validated before mutation. Missing workspaces and empty discovery are failures, not skipped successes.
- Versioned self-checks share canonical task identity with provenance. Separate validation-input identity covers references and clean codebases; neither is confused with source provenance.
- Stamp reads are bounded, regular-file/no-follow/nonblocking; malformed, duplicate, failed, stale or missing evidence blocks before provider/job work.
- Generated build-context policy is an independently verified exact workspace-only allowlist. Canonical task hashing still excludes `.dockerignore`; altered/missing policy and Dockerfile-specific overrides nevertheless block image/eval admission.
- Initial solved success is followed by **five additional repetitions**: six solved grades plus the required empty-baseline failure. The earlier five-total interpretation was corrected without weakening requirements.
- Nonce-bound grading-wrapper completion is distinguished from Docker infrastructure failure. Timeout remains a failed grading outcome but is not evidence of a completed baseline check.

## Focused verification

From this checkout:

```sh
node --import tsx --test \
  packages/runner/test/fixture-admission.test.ts \
  packages/runner/test/provenance.test.ts \
  packages/runner/test/problems-overlay.test.ts \
  packages/runner/test/container-image.test.ts
node_modules/.bin/tsc --noEmit -p tsconfig.json
SPECPLANE_CLI=/workspace/scratch/8329530da55a/repos/specplane/packages/cli/dist/cli.js \
  node scripts/check-specplane-migration.mjs
```

Results: **147 focused tests passed, zero failures/skips**; typecheck passed; exact Specplane migration/preservation validation passed. All 19 imported specs and immutable inventories remain preserved. The verified CLI SHA256 was `10d3df1682997cea7dde625f7640e9816a54b263aba3838d308e783fc6daea2f`.

Local focused log: `/tmp/fixture-admission-focused.log`, SHA256 `6a652be9645df4428abcc40045c2022a9d49780ee7bd91eed76282d8d3274e5c`.

## Parent-owned common serial suite

Independently recounted the parent's `/tmp/aiw-fixture-admission-full.log` TAP summaries:

| Group | Passed |
|---|---:|
| Script entry/preservation tests | 24 |
| core | 181 |
| llm | 70 |
| runner | 288 |
| server | 22 |
| telemetry | 17 |
| tools | 104 |
| viewer | 1 |
| **Package subtotal** | **683** |
| **Total including scripts** | **707** |

All eight TAP summaries report zero failures and zero skips. The log begins with test-file concurrency 1 and ends with the successful package-tests/typecheck sentinel. These are the same package/script tests, serialized for the constrained executor, not omitted tests. Parent owns this execution; this child verified the saved evidence and counts rather than rerunning the broad suite.

Full-log SHA256: `7c3bc30ef845d0f9d47549a8c5ef0327a9d2e7f28dc5f30e31c156bf00b041c9`.

Exact parent invocation, executed from this fixture-admission checkout:

```sh
AIW_TEST_CONCURRENCY=1 \
AIW_VENV=/workspace/scratch/8329530da55a/repos/ai-workflow-baseline/packages/tools/.venv \
node --input-type=module -e "import {main} from '../ai-workflow-test-isolation/scripts/test-cloud.mjs'; main(process.cwd());" \
  > /tmp/aiw-fixture-admission-full.log 2>&1
```

The serial harness is an independent published candidate, not an unrecorded edit to this checkout's test entry. Verified its local HEAD `7bd10f3de551cef18390eee8a69352fc8b2d9dbd`, tree `36501fcfb0329f4ad9b9ee9d49fba8b80312e964`, and script SHA256 `5957ff77dd30affe27bdabfe4c6ecebe337fb189661748876fa820aa034e1de5`. Parent reports published transport commit `9cd1381c0ac200c76a42fb0dcc1be891bc7c4767`; this child did not make a remote verification call. Source inspection confirms `main(process.cwd())` enumerates and executes this fixture checkout's script/package tests and typecheck, with `--test-concurrency=1`; it does not run the harness checkout's package suite.

## Limits and remaining review

- Tests use temporary synthetic inputs and fake Docker/provider boundaries. Local Python/native/tool regressions in the parent's common suite are not real benchmark self-checks. No passing stamp was fabricated for a repository fixture.
- A wrapper completion marker proves wrapper completion, not trustworthy arbitrary test content. Stamp/tree evidence is trusted-local metadata, not an adversarial same-UID race sandbox; overall task-tree hashing remains unbounded.
- No benchmark fixtures, checks, prompts, imported specifications or original inventories were changed. The full-success **10×3×2 matrix remains unchanged**.
- Parent reports the final independent delta review found no blockers. That technical review and the passing suite are not human approval, readiness or finalization; committing/publication remains with the parent under the user's authorization.
- Parent-owned bundle/native-Docker readiness and any separately authorized campaign execution remain distinct evidence. This document does not claim a new composed bundle/native-container check was run merely because source tests passed.

Draft plan, detailed gaps and current handoff: `plans/2026-11-02-fixture-admission/`. Exact runtime deltas and source-base anchors remain in `.specplane/development-allowances.json`; original before-states were not rewritten.
