# Transport-only verified-tree CI — never merge

This branch is an isolated execution carrier, not an implementation branch. Never merge
`dot/docker-tree-ci-20261101` into master, the migration PR, or another development branch.
The user authorized GitHub Actions for Docker. No plan/spec approval or merge is performed.

## Exact reviewed source

- Tested local source commit: `e301baedd1ece152cf22dd56f656e5761fc2c745`
- Immutable source tree: `4fb02bff34675cb62b00aa9e6d1dea9b2bf70842`
- Expected inventory: 823 regular/executable files; no symlinks or submodules.

The source tree and its blobs were already uploaded and verified through GitHub REST.
The bulk commit service returned an unexplained 422 despite readable objects. Separately,
the same connection successfully published and ran a Docker smoke workflow, confirming
workflow-write access. This transport uses ordinary supported REST reads of our own
reviewed objects, not permission changes or alternate credentials.

The restoration helper reads the fixed GitHub API origin with the workflow's ephemeral
Contents-read token. It rejects all redirects, bounds each response, limits source sizes,
and fetches missing unique blobs sequentially with no retries. It reuses locally present
Git blobs only after checking their content hash. Paths, object identities and modes are
validated; absolute paths, traversal, `.git` components, symlinks and submodules are rejected.
Git subprocesses never inherit the token. The token is scoped to this single workflow step
and is not present in subsequent test/dependency steps.

Every blob is verified against its Git SHA1 object identity. An empty temporary Git index
is reconstructed, and `git write-tree` must equal the exact reviewed root above before any
source file is materialized or source command runs. Missing/unavailable objects fail closed;
there is no fallback to a newer branch. The temporary tree checkout does NOT reconstruct
or claim the source commit's Git history; source commit provenance is documented above,
while the source content and file modes are independently verified by the root tree hash.

## Upload order (parent task only)

1. Create isolated `dot/docker-tree-ci-20261101` from the already reviewed PR snapshot
   that contains no GitHub workflow files.
2. Upload this README as `.ci/README.md` and `restore_source.py` as `.ci/restore_source.py`.
3. Optionally upload `test_restore_source.py` as `.ci/test_restore_source.py` for review.
4. Verify those uploaded bytes match the reviewed local files.
5. Upload `offline-docker-tree-ci.yml` to `.github/workflows/offline-docker-tree-ci.yml`
   last. The exact-branch push trigger then starts the one job.

All original source CI commands and their step timeouts remain identical. The additional
10-minute restoration gate precedes setup and tests. Read-only Contents permission, pinned
official checkout/setup actions, no persisted checkout credentials, standard public Ubuntu
runner, bounded total duration and superseded-run cancellation remain in place. No secrets,
paid model calls, cache/artifact storage, deployments or custom Docker networks.

Docker capability → existing image build → actual smoke selfcheck → Python dependencies →
host suite/typecheck/diagnostics → remaining sequential Docker selfchecks. Failure blocks
all subsequent stages. Dependency installation uses network; grading containers use the
existing network-none isolation. No model success or cost reduction is claimed.

## Validation

Five local unit tests cover verified local reuse, corrupted remote blob, path traversal and
unsupported modes, unavailable tree, and final root mismatch. Failure cases never materialize
source files. The exact 823-file reviewed source tree is also reconstructed locally from
verified Git objects without network; final tree equality is required. Workflow YAML checks
confirm exact trigger/permissions, token scoping, and original command/timeouts parity.
Actual Docker execution and remote REST transfer still require the Actions run.

The incomplete base64-bundle branch remains an unused backup, not a ready workflow.
No helper test or local restoration is a substitute for actual Docker grading.
