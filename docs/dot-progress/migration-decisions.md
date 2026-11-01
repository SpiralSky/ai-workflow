# Experimental migration decisions and evidence

## Scope and authority

The user clarified on 2026-11-01 that specification approval should not block experimental parallel development; approval remains required for final merge. The goal is full task success, refining each candidate against the full test set, with cost measured alongside success rather than using cost per success as the optimization target.

This is an experimental migration, not approval of specifications, a plan, or a final merge. No approval, finish, merge, cleanup, branch deletion, or permission-expansion command was run.

## Branch relationship

- Branch: `dot/migrate-specplane-experimental-20261101`.
- Base: `dot/evaluation-correctness-20261031`, `b2e781f83976e6807f341debea216dcc56a6ff5d`.
- Separate worktree: `ai-workflow-migration` beside the original checkout.
- The inherited evaluation-integrity fixes are retained unchanged.
- Framework: initial format/CLI checks use a local development Specplane distribution with base `21317cf335a2602f2a7873a929425d7a6b6ef336`. Its working tree may be changing independently; these initial checks do not assert an immutable enhanced release. The completed enhanced Codex/cloud integration is a dependency for final migration validation; it has not yet been tested here.

## Autonomous experimental mappings

1. **Preserve requirements.** All eight feature and eleven architecture bodies are byte-for-byte unchanged. A machine-readable manifest records each source hash and architecture's `implements` references, derived from the old architecture index.
2. **Preserve approval evidence without creating approval.** Feature files carry `migration_source_status: Final (legacy index)` and the source commit. Current Specplane status is `review`. Architecture files record their old unspecified lifecycle and also use review. This is a conservative import state, not a reversal of historical user decisions or a new approval.
3. **Allow development, retain human final authority.** Experimental config permits feature drafts and removes the approved-spec prerequisite for development. Architecture approval still requires approved features. Plans remain draft; no plan is made ready/done. Their actual CLI gate remains observable. Independently authorized experimental work is recorded here instead of pretending a draft plan ran.
4. **Permit isolated candidates.** Git-derived statuses avoid default-branch claim commits. Stack dependency mode supports unmerged candidate relationships. No finalization is invoked; pull-request merge mode does not authorize creating or merging a PR.
5. **Use Specplane precedence.** Architecture drives implementation detail, feature requirements govern user-visible behavior, and contradictions block only the affected work. The old index's silent feature-wins rule is replaced explicitly in INFO.md. No requirement body is changed.
6. **Retain historical records.** Root HANDOFF and all four pending-review records plus their template remain unchanged. Implemented code is not treated as proof of human approval. Existing runtime framework, plugin marketplace, benchmark fixtures, package dependencies and accounting changes remain unchanged.
7. **Avoid permission expansion.** The neutral managed AGENTS block was generated using Specplane's standing-instruction function. `init` was not run because its automatic Claude detection would add broad `Bash(specplane:*)` permission. No hook/settings file was installed. The absent Claude rules warning is disclosed, not hidden.
8. **Keep leak guard active.** Existing architecture-like terminology in the inherited feature bodies produces warnings. No global exemption or fabricated clean report was added.

## Framework contract references

The managed AGENTS block refers to Specplane's `architecture/agent-skills` and `architecture/file-formats`, not ai-workflow specification IDs. Read those contracts from the separately checked-out, pinned Specplane distribution. This distinction avoids introducing unrelated framework specs into the project's requirement graph. The forthcoming enhanced harness must provide the same clear route.

## Reproduction

Use Node 22+ and the same dependencies as the base checkout. This migration reused a local dependency-directory snapshot from the evaluated base (preserving relative workspace links into this worktree); it did not change package-lock or install credentials.

```
export SPECPLANE_CLI=/absolute/path/to/specplane/packages/cli/dist/cli.js
node scripts/check-specplane-migration.mjs
node "$SPECPLANE_CLI" validate --json
node "$SPECPLANE_CLI" spec list --json
node "$SPECPLANE_CLI" plan next 2026-11-01-specplane-migration --json
npm test
npm run typecheck
```

The migration checker is scoped to this migration branch: it deliberately rejects subsequent runtime changes relative to the migration base. Optimization candidates should retain its historical report and use their own change-specific tests rather than remove this preservation assertion to manufacture a pass.

## Results so far

- Initial CLI validate: valid, zero errors. Warnings: 27 tech_name, 39 path, 189 identifier, one freshness (Claude rules absent). These warnings remain visible.
- Migration checker: passed, 19 specs, six preserved historical files, no runtime/plugin/evaluation asset changes.
- Draft plan `next`: read-only response remains draft/non-executable. Exit code 0 denotes successful status query, not permission to execute.
- `npm run typecheck`: passed.
- `npm test`: blocked before relevant assertions by tsx CLI trying to create a local IPC socket (`EPERM`). This is not a passing package suite.
- Direct supported Node entry (`node --import tsx --test packages/*/test/*.test.ts`): 318 tests, 257 passed, zero failed, 61 skipped because the Python tool venv is absent. This avoids the optional tsx CLI IPC startup without changing security settings.
- Legacy `framework/` has no package.json/test script at this base; the old instruction to run npm test there is not executable as written.
- Full direct Node rerun with the verified baseline Python tool venv: **318 tests passed, zero failures, zero skips** (2026-11-01; ~10.5 seconds). Set `AIW_VENV` to the baseline checkout's `packages/tools/.venv` and `XDG_CACHE_HOME` to a writable temporary directory. This is the package test suite, not a full live-model benchmark.
- Enhanced-framework representative workflow: pending; results will be recorded separately.

Full benchmark task success and monetary cost are not measured by this migration. Docker/model and evaluation prerequisites remain separate, and no savings claim is made.

## Portable configured cloud test entry

The configured `plans.test_command` is `node scripts/test-cloud.mjs`, not the failing tsx CLI wrapper.
This runs the same package test files in their own workspace with Node's `--import tsx` entry,
then typecheck. The normal `npm test` scripts are unchanged. It requires a verified Python tool
venv (`AIW_VENV`, repository-local `.venv`, or the existing standard container location), creates
only an isolated writable temporary cache for each run, and rejects skips or missing test summaries.
It never installs dependencies, changes permissions, or claims benchmark task success. The viewer
has no test directory and is reported as lacking test coverage, not as tested.

```
AIW_VENV=/path/to/verified/venv node scripts/test-cloud.mjs
```

The venv path is supplied by the execution environment, never hardcoded into portable config.
No `plan finish` command is needed or authorized to invoke this configured test command.

The first configured-entry trial inherited an existing read-only XDG cache and correctly failed six tool tests. The entry now always uses a fresh temporary cache; it does not change the machine cache directory or tool implementation.

Configured cloud entry verified after cache fix: 318 package tests plus four entry tests passed,
zero failures/skips, and typecheck passed. Viewer test coverage remains absent as explicitly reported.

## Common evaluation-integrity integration

Parent reviewed and authorized replay of variant-correctness commit
`f725502210e25a49b57fb6d62d5666291adab17c` from
`dot/variant-correctness-20261101`. It was cherry-picked as `e19be3b` after the cloud test entry
commit `0022414`; no branch was merged, approved or deleted. This corrects actual variant
parser/dispatch behavior and is a shared evaluation prerequisite, not a candidate optimization.
The manifest now explicitly names that runtime-integrity reference for runtime preservation checks;
imported specification bodies remain compared with their original `b2e781f` source. This keeps
runtime changes attributable instead of weakening the preservation assertion. Configured tests
are rerun after integration; previous 318-test results do not establish this new state.

After variant integration, the actual configured cloud entry passed **353 package tests + four
entry tests**, zero failures/skips, followed by passing typecheck. The migration checker also
passed against the explicit runtime-integrity reference. Enhanced Codex-harness validation remains
pending and is not implied by these tests.

## Accounting, overlay and default viewer-test integration

Reviewed accounting source `9ad0fd9276b91137b333b1af298f46a62461884c` was replayed as
`3af6842`; reviewed overlay materialization source `6812b66a71b66a854bef81acce85f57f12d53cc4`
was replayed as `1a501dd`. Source branches remain intact. These are common correctness
prerequisites, not measured optimization candidates. The runtime preservation reference is now
`6812b66`, while requirement-body provenance stays at `b2e781f`.

The accounting prerequisite adds viewer cost tests but leaves its old npm script saying there
are no tests. A separate test-entry correction uses `node --import tsx --test test/*.test.ts`.
The manifest and checker permit exactly this scripts.test field change; they compare all other
viewer package metadata and runtime assets to the reviewed reference. Other packages' normal
root npm test wrappers still use tsx CLI and retain the cloud IPC limitation; the configured cloud
entry covers every package's test files, including viewer, without weakening their assertions.

## Enhanced-framework consumer validation

The actual enhanced framework at `6ae4e304faa75b7bd5ae1240da7f4693f48d0a4e`
(`dot/codex-integration-20261101`) was tested against this migrated checkout:

- Explicit `init --harness codex` installed only the managed AGENTS block and
  `.agents/skills/specplane/SKILL.md`. Existing config/spec indexes were preserved.
- Repeating the command was idempotent. Hashes of all existing Claude/Codex/plugin files
  matched before/after; no settings or permission files were created.
- The installed skill's bytes are pinned in the migration manifest.
- `validate --json` passed with zero errors. Remaining warnings are the inherited feature-body
  leak findings (27 tech_name, 39 path, 189 identifier) and one existing-Claude-rules freshness
  warning. No leak guard was disabled and no Claude permissions were installed to silence it.
- The initial upstream contract-resolution warning was fixed in the enhanced framework by
  validating its bundled contract snapshot. The consumer has no copied unrelated framework specs
  and no contract warning at the pinned enhanced commit.
- `spec list` resolved exactly the 19 imported IDs. `plan next` resolved both real feature-context
  paths and returned draft/action:none, preserving approval state and creating no checkout.
- A conductor dry run stopped at the no-checkout gate (code 5); it did not execute a draft plan.
  The enhanced integration supports this existing Dot/Codex execution session, not a background
  Codex adapter. No background session success or approved conductor execution is claimed.
- The configured cloud test entry was invoked directly, not via forbidden plan finalization.

These checks verify the migrated manual experimental workflow. They do not constitute plan
approval/finalization, final merge approval, live-model full-task success, or measured cost savings.
Earlier pending integration notes above describe intermediate checkpoints; this section records
successful consumer integration at the exact enhanced commit.

Final integrated verification after accounting/overlay prerequisites and viewer entry correction:
**384 package tests + four cloud-entry tests passed, zero failures/skips; typecheck passed.**
`npm test --workspace @aiw/viewer` independently passed its new cost test. The separate viewer
entry commit is `4cc85e0`. Enhanced consumer validation and the migration preservation checker
passed with the documented warnings. No root `npm test` pass is claimed for the other tsx CLI
wrappers, and no live-model benchmark has been run by this migration task.
