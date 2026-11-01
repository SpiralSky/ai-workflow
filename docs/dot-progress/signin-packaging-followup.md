# Sign-in review: verified packaged-runtime follow-up

Development evidence only; not a plan approval, merge approval or live authorization result.
Based on the published PR2 source `7caf3294f6c861edd13f49f65d000dd511eee409`.
The bounded implementation supplies required native/tierL resources for the requested workflow
rather than weakening readiness checks. Original migrated specs/history and inventories remain unchanged.

## Provenance

| Source commit | Local replay | Scope |
|---|---|---|
| `1ef281b95e4af6e60fdd343766c35f624da3466e` | `e3fed1714a51cad7a5d1d3984315c4df992cbdee` | Readiness audit |
| `676fa45413d1ca0194d06163688e6fbe688af18c` | `39c30f8dbf28e8e54984c0e00dbb8d4a8a7a8313` | Native dependency closure, portable Python/external resources, tierL initialization and host cleanup |
| `9c7ade28abe19fd26c5d0cb33bcdfe791ba18b2a` | `97d56ba8287b3e22d9206686478bd17fa75b3d3e` | Offline Docker preflight and canonical Python dependency pins |
| `460b76127f073e39cafaed16128d49e53e4d45fe` | `5afdf2111a6d8c0ce9e6f771c024254ebe4250a4` | Minimal Docker build context whitelist |
| `e301baedd1ece152cf22dd56f656e5761fc2c745` (selected files only) | `05cd6feb2114b0757d9d973d6784f22301e45897` | `packages/runner/src/container.ts`, `packages/runner/src/grade.ts`, `packages/runner/test/container-image.test.ts` |

The last row is **not a full cherry-pick**. It preserves validated immutable Docker identity
and injective case-preserving task tags; no source CI wrapper or benchmark task fixture expansion
was imported. Parent reports Docker CI run41267929116 verified these source changes; this
integration's offline command-boundary tests are separately recorded below.

Source merges were clean. Rebuilt `node packages/server/build.mjs` from the final composed source;
the generated tracked artifact already matched the clean textual merge, verified independently
by `--check`. Auth host-broker flags/forwarding, explicit engine selection and close hooks remain.
Machine-specific dependency closure is generated from installed lockfile dependencies, not committed.
Portable Python resources/external deterministic fixtures **are** committed runtime resources,
not additions to the benchmark task set.

## Preservation

`.specplane/development-allowances.json` now enumerates77 runtime deltas (was44), with original
before hashes/modes retained and exact final after hashes/modes. Its `packaging_followup` additionally
records the before/after transition from PR2's original source. The two original inventory hashes
remain anchored. Only `experiments/docker/aiw-base/Dockerfile` and its `.dockerignore` are allowed
outside the existing bounded package scope; other experiment changes still fail closed.
Two extra snapshot-only regression tests reject sidecar byte tampering and Docker context expansion.
All imported specs remain review and new plans remain draft; no status approved/ready/done introduced.

## Offline verification

On composed source `05cd6feb2114b0757d9d973d6784f22301e45897` plus this preservation follow-up:

- Configured `AIW_VENV=<verified baseline venv> node scripts/test-cloud.mjs`:501 package tests
  +21 script tests, zero failures/skips; root TypeScript check passed.
- Focused relocated native/tierL packaged MCP + bundle freshness/engine + Docker identity:41 passed.
  Actual native branch returned42; tierL outline/check/external issues/diff/restore worked from a
  relocated bundle with no repository-relative resources. This is the local Node24 environment.
- Focused auth/Responses/broker/subscription:39 passed, no network authentication/model calls.
- Preservation regressions:17 passed including fresh Git snapshots lacking historical source refs.
- Actual pinned enhanced Specplane CLI validation/checker passed with77 explicit deltas;
  inherited feature-leak and absent Claude rules freshness warnings remain documented.
- Final source/portable resources freshness check passed.
- Actual snapshot-only repository `/tmp/aiw-signin-packaging-snapshot-acekbdi1` passed the
  enhanced checker with both historical refs unavailable;77 deltas checked from self-contained
  inventories. JSON evidence: `/tmp/signin-packaging-snapshot-check.json`.

Logs are `/tmp/signin-packaging-{full,focused,security,preservation}.log` and
`/tmp/signin-packaging-framework.json` on this executor (ephemeral evidence, not dependencies).

## Remaining boundary

Actual target Node22 native/tierL Docker probe is delegated to parent Actions execution using
`scripts/test-packaged-docker.sh`; it was **not run locally** and no target-container success is
claimed here. Building the image downloads pinned dependencies, while the capability probe itself
uses `--network none`. No live OAuth, subscription requests, model calls, secrets setup, production
changes, approvals, merges or publication occurred in this integration task.

## Independent security/lifecycle review

The security reviewer found no OAuth broker privacy regression: host-only broker flags remain,
and Docker context whitelist remains narrow. Two limits remain explicit:

1. Current `Sidecar.close()` kills the Python parent only. A running child command may outlive
   direct CLI EOF/SIGTERM. Container removal eventually removes its processes, but direct CLI
   descendant cleanup is not yet demonstrated. A focused runtime lifecycle fix/regression has
   been requested; do not treat this snapshot as proving complete child cleanup.
2. `buildImage` records an immutable image identity, but candidate/grading launch still use the
   mutable task tag. This preexisting design is not pinned-launch provenance. The provenance
   worker has been notified; do not equate a recorded ID with proof of the launched image.

These findings qualify readiness independently of the passing offline tests above. No live
native workflow, full model-task success, or cost improvement is claimed.

## Graceful lifecycle closure

The first limitation above is fixed for cooperative POSIX shutdown by source
`632f205e60804141254d8e04344a17e282c058be`, cleanly replayed as
`773107f16a9a60b62cf72e0919f194c808cabdc5`. Sidecar TERM/EOF now cancels/reaps owned child
groups, and LocalHost awaits bounded shutdown before disposing snapshots. A final source rebuild
matched the tracked artifact. The allowance log retains the previous hashes and records this
transition separately;81 final deltas include only three explicitly named tools source paths.

The independent reviewer reran three actual child+grandchild regressions on the source patch:
direct Sidecar.close, packaged CLI EOF, and CLI SIGTERM. All passed. This is not a promise of
containment after forced SIGKILL, host crash or hostile descendants escaping into new sessions.
The immutable-record/mutable-launch caveat remains until the separate provenance patch is integrated.

Final imported-source security review confirmed four lifecycle source files identical to the
reviewed patch, verified bundle freshness, and independently reran all three lifecycle tests
on the composed sign-in branch (3/3 pass). No remaining blocking finding in this bounded review;
this is not plan/PR approval.

Final integrated configured suite after lifecycle replay:504 package tests +21 script tests,
zero failures/skips, root typecheck passed (`/tmp/signin-lifecycle-full.log`). Enhanced checker
and bundle freshness pass with81 explicit runtime deltas (`/tmp/signin-lifecycle-framework.json`).
