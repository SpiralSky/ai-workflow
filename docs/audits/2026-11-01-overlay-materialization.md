# Overlay materialization correctness — 2026-11-01

## Result and branch relationship

- Branch: `dot/overlay-correctness-20261101`; worktree: `repos/ai-workflow-overlay`.
- Parent: accounting correctness `9ad0fd9276b91137b333b1af298f46a62461884c`, not the migration or optimization branch.
- Fix: the production problem builder consumes `overlay/.delete` without copying this root control file into the model-visible workspace. The previous implementation copied the entire overlay and silently ignored every copy/delete error.
- Existing contract: problems specification §6 describes materializing codebase plus overlay. Existing `.delete` handling defines it as build metadata, not task source. No specification or approval status changed.

## Autonomous decisions (not user approvals)

1. Exclude only the overlay root `.delete` from copy; nested files of that name remain ordinary source files. Preserve the source manifest itself, including on repeated builds.
2. Prevalidate the complete manifest before copying or removing anything in the overlay phase. Reject absolute paths, traversal components, NUL and workspace-root deletion. Missing target files remain harmless.
3. Reject symlink traversal in delete/copy destinations and symlink overlay sources/control files. This deliberately conservative restriction avoids following a link outside the target and makes unsupported inputs explicit. Existing symlinks unrelated to an overlay/deletion path are not removed. Directory deletion itself uses Node's non-following recursive removal.
4. Only absent overlays/manifests are ignored; malformed inputs and filesystem failures now propagate. This is not a filesystem transaction: an I/O failure during copy can leave a partially copied workspace. The builder still replaces its generated workspace before applying an overlay, as previously.

The implementation assumes repository inputs are stable during a build, not maliciously changed concurrently between validation and filesystem operations. It is not a race-resistant hostile-filesystem sandbox. Existing problem-id/codebase selection and codebase verification behavior are unchanged; this patch does not claim to harden all builder inputs.

## Validation and reproducibility

All fixtures live in temporary directories and are cleaned up by tests. No `experiments/**` files or committed workspaces were modified.

- 13 focused tests: root control-file exclusion, content replacement, nested `.delete` retention, repeated application, missing optional inputs, traversal/absolute/root/NUL rejection before mutation, outside-file preservation, copy/delete symlink rejection, malformed manifest rejection, and production `buildProblems` materialization.
- Production integration test substitutes only a temporary `docker` executable returning success for pre-overlay codebase verification. It exercises the actual builder copy/filter/delete path; it does not claim Docker/codebase-test validation.
- Root `npm run typecheck`: passed.
- `npm test`: attempted; inherited `tsx` CLI Unix IPC restriction (`listen EPERM /tmp/tsx-1000/*.pipe`) remains. Supported loader fallback used instead:

```sh
XDG_CACHE_HOME=/tmp/aiw-baseline-cache \
AIW_VENV=/workspace/scratch/8329530da55a/repos/ai-workflow-baseline/packages/tools/.venv \
node --import tsx --test packages/core/test/*.test.ts packages/llm/test/*.test.ts \
  packages/runner/test/*.test.ts packages/server/test/*.test.ts \
  packages/telemetry/test/*.test.ts packages/tools/test/*.test.ts packages/viewer/test/*.test.ts
```

Full final loader run: **384 tests passed, 0 failed, 0 skipped** (log `/tmp/aiw-overlay-final.log`). Dependencies were reused through a temporary symlink to `../ai-workflow-accounting/node_modules`, removed after validation; no package installation or lockfile changes. `git diff --check` passed. No paid calls, live evaluations, cost reductions, plan approvals/finalization, merges or pushes.
