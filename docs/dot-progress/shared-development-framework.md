# Shared development framework — 2026-11-02

**Development integration only; all plans remain draft.** Branch `dot/dev-framework-20261102`,
worktree `ai-workflow-dev-framework`, exact base `67b42ae04153079e84b1fdacdd0082a2e623ffc8`.

## Authority and composition

User: “Yes, this authorizes merges between the development branches only.”
The user also requested evaluation with native dot assignments and local tests, while noting that
Astra pricing may require token/cache estimates or relative comparisons and cache invalidation may
be difficult to detect. These local gates neither expose nor establish that usage/quota evidence.

Each independent shared branch was merged with `--no-ff`, with no conflicts or history squashing.
The development inventory branch was then merged as historical context. No protected/default branch
changed. Selector-reuse and hotpath are deliberately excluded: they are treatments, not shared gates.

| Merge commit | First parent | Shared source parent |
|---|---|---|
| `e54f50885b9c9a1d444680961f27ef0da4525685` | `67b42ae04153079e84b1fdacdd0082a2e623ffc8` | `a572d66d4891a2bcd87f29f20112fc66bcb36494` |
| `163bfc087472ab972f263667fd522ec964cfe523` | `e54f50885b9c9a1d444680961f27ef0da4525685` | `7bd10f3de551cef18390eee8a69352fc8b2d9dbd` |
| `b291d95ab75de679057387de8bb75c1e68147608` | `163bfc087472ab972f263667fd522ec964cfe523` | `1039f358dfce62978316c2ee610c38acff331ee7` |
| `359cfd528abf1c2ec7072fa1af017c469ae3c6b8` | `b291d95ab75de679057387de8bb75c1e68147608` | `f2061ca7971158713b8784699aafbacba5c171d8` |
| `41efc6b1e91f107ece4ae97f4b9f219f8a5f7e78` | `359cfd528abf1c2ec7072fa1af017c469ae3c6b8` | `8b3c5f16b7f4b85bd30c4aee464904bafd52b115` |

## Composed acceptance path

`node scripts/test-cloud.mjs` now requires, in order:

1. Every existing top-level `scripts/*.test.mjs` entry/preservation test.
2. Offline design checker plus its self-tests in normal **and optimized `-O` Python**.
3. Nested `scripts/dot-native/method.test.ts` synthetic contract tests.
4. Standalone strict TypeScript check for native method/CLI/tests (outside package tsconfig scope).
5. Every unchanged discovered `packages/*/test/*.test.ts` file in its original workspace.
6. Existing final package-project TypeScript check.

`AIW_TEST_CONCURRENCY=1` still reaches every Node test child, while unset retains Node defaults.
All stages are sequential and fail fast. Python now emits actual test counts and rejects empty,
skipped, expected-failure, failed or error outcomes even when unittest would exit successfully.
The JavaScript parent independently checks those counts and the offline design result. Every Node child requires unique well-formed final TAP counts, positive tests, passes equal to tests,
zero failures/cancellations/skips/TODOs, and named test evidence. Node's file-only fallback for an
empty module is rejected using normalized expected file paths. No old test, assertion, timeout, or matrix was removed. Clean-codebase admission was additionally
hardened as described below.
This composed entry requires the composed checkout; the older isolated scheduling helper can still
be used for historical prepared baselines without claiming these new shared gates were present.

## Exact preservation and setup

- Original specification bodies and both original migration inventories are byte-immutable.
- Fixture-admission runtime allowances are inherited unchanged. Existing original `before` hashes
  remain unchanged; additive `shared_framework_integration` metadata records exact merge parents and
  the extra script/runtime-source before/after hashes, relative to composed parent `41efc6b1e91f107ece4ae97f4b9f219f8a5f7e78`.
- The lockfile exactly matches sibling `ai-workflow-dot-native`. Its materialized `node_modules`
  was copied locally, preserving `.bin` relative symlinks; `@aiw` workspace links point here.
  Nothing was downloaded or installed; lockfile and package files are unchanged.
- Existing `node packages/server/build.mjs` prepared the native closure. `--check` passed, with no
  tracked source or artifact byte delta. This is setup, not a new implementation or Docker result.
- Python uses the existing verified sibling `ai-workflow-baseline/packages/tools/.venv`.

## Actual focused evidence

- Harness orchestration: **28 passed**, zero failures/skips.
- Real Python design self-tests: **12 passed normal + 12 passed under `-O`**, zero incomplete outcomes;
  canonical design valid, live calls 0, manifest not verified in this invocation, readiness flags false.
- Real nested native contract: **16 passed**, zero failures/skips; strict standalone typecheck passed.
- Local logs: `/tmp/aiw-dev-framework-harness.tap`, `/tmp/aiw-dev-framework-design.json`,
  `/tmp/aiw-dev-framework-design-optimized.json`, `/tmp/aiw-dev-framework-native.tap`.
  Machine summaries were checked by the same production exit/skip validators.

The coordinated full serial aggregate passed as recorded below. Focused counts above are
subsets/earlier runs, not additional package/native acceptance cases.
Native contract cases are synthetic compiler/QuickJS checks, not new solver assignments or benchmark
quality. Actual assignment, tokens, cache invalidation, model pricing and quota remain separate
parent-owned evidence; no known quota/free billing, savings, full-fixed60, deployment or approval claim.

## Independent review corrections before aggregate acceptance

The read-only reviewer identified two remaining fail-open details. Both were corrected before
starting any composed broad suite; earlier independent branch results remain historical evidence.

1. The inherited TAP gate checked only exit and skipped count. It now rejects zero tests, TODOs,
   cancellations, mismatched pass totals, malformed/missing/duplicate summaries, absent named tests,
   and Node's successful empty-file fallback. Nested indented suite evidence remains valid.
   The new actual empty-module regression initially inherited Node's parent test-worker context,
   giving a missing-summary failure rather than the intended empty-file output; the regression now
   clears only `NODE_TEST_CONTEXT` for that independent synthetic child. Final harness is 28/28.
2. Clean-codebase admission formerly accepted unittest skips/expected failures as successful.
   The exact Docker Python command now requires a positive discovered count, all discovered cases
   executed, successful results and no skipped/expected-failure/unexpected-success outcomes before
   workspace replacement/overlay. Eight temporary local Python scenarios exercise that actual
   command through the fake Docker boundary: success, empty, all/partial skip, expected failure,
   unexpected success, assertion failure and error. **93 fixture-admission tests pass**, zero skips;
   no Docker executable, real fixture mutation, provider or model was used.

The two extra runtime source/test hashes are explicitly recorded in the additive integration
metadata and canonical runtime allowance after-states. Original inventory and allowance before-states
remain untouched. These are stricter admission requirements, not relaxed test assertions.

## Composed serial acceptance — passed

Exact invocation from this isolated central worktree:

```sh
AIW_TEST_CONCURRENCY=1 \
AIW_VENV=/workspace/scratch/8329530da55a/repos/ai-workflow-baseline/packages/tools/.venv \
node scripts/test-cloud.mjs > /tmp/aiw-dev-framework-full.log 2>&1
```

One composed broad attempt was run; **exit 0**. Node 24.22.1; Python 3.12.14.

| Stage | Tests passed |
|---|---:|
| Top-level entry/preservation scripts (includes harness regressions) | 48 |
| Nested dot-native synthetic contract | 16 |
| core | 181 |
| llm | 70 |
| runner (includes 93 fixture-admission cases) | 296 |
| server | 22 |
| telemetry | 17 |
| tools | 104 |
| viewer | 1 |
| **Package subtotal** | **691** |
| **Node total** | **755** |
| Python design contract, normal interpreter (separate) | 12 |
| Python design contract, optimized interpreter (separate) | 12 |

Every Node summary reports zero failures, cancellations, skips and TODOs. Both Python reports have
zero failures, errors, skips, expected failures and unexpected successes. Strict standalone native
TypeScript and final package-project TypeScript checks passed. Actual packaged freshness and
relocated native/tier-L runtime-resource tests passed; this is not a Docker/CI readiness claim.
Mock orchestration responses are not added to these actual test counts. The old focused counts
are not added again. Full-log SHA256: `d38a277b12c4b62d2ee3d7b6a43a4746d793a8bf3df9ffbf148dc00ea8028d4e`.

Read-only review cleared strict TAP/clean-codebase fixes and preservation before the aggregate;
its reviewed staged diff SHA256 was `f05c4014a2449807aaa4569b6573bef2c230429d4eb41c91e50586c52ebd34b4`.
Migration preservation passed after those fixes: 19 imported specs, 6 preserved files, 118 exact
runtime allowance paths; original source/runtime inventories verified against available history.
Specplane validation: valid, zero errors, 258 existing warnings; the new plan remains draft/action none.

Tested source is frozen in development commit `2e9a53ac76a5c8bdf9543b48b8f15f16ff1c87e4`.
The subsequent record commit adds the parent-authored [experiment registry](../ideas/experiment-registry.md)
and this source pointer only; no tested source/allowance changes. Publication and independent
propagation into treatments are parent-owned. No final/default merge or approval is authorized here.
