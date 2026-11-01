# Baseline readiness audit, 2026-10-31

Status: investigation only. No plan approved, finalized, completed, or merged. No feature-specification or production-code changes. No model calls or monetary savings measured.

## Branches and provenance

- Source: `SpiralSky/ai-workflow`, default `master`, commit `9e0f0826bba1bd08a1684e6a25a92872c40241e9`.
- Parent coordination branch: `dot/progress-20261031`.
- Independent audit branch/worktree: `dot/baseline-audit-20261031`, `../ai-workflow-baseline`, directly from `origin/master` at the same commit.
- Migration is not performed here. User corrected the framework repository name to `specplane`; that inspection is separate.
- No branch pushed or merged by this audit.

## Approval gates preserved

`CLAUDE.md` makes feature specifications authoritative. `docs/specifications/features/README.md` marks all feature specs Final; changes require the user's approval. Runner §6.6 explicitly treats tuning changes as reviewed/approved spec changes, except minor bug fixes. `HANDOFF.md` forbids autonomous feature-spec edits and routes decisions to pending review.

Four `.claude/pending-review/2026-10-27-*.md` files retain pending statuses. Later HANDOFF step 7a and commits `af86bbd`, `fe6c2b1`, and `b7cd376` describe prompt wording and `replaceSymbol` as implemented and the older two decisions as resolved/deferred. This is a record inconsistency, not evidence authorizing a new approval. All files and statuses are unchanged.

## Baseline validity blockers

1. **Nested model cost is not included in job totals.** `packages/runner/src/loop.ts:194` sums only main completion costs; `job.ts:139,172` returns that sum. Selection and secondary calls have telemetry in `core/src/orchestrate/selection/rerank.ts` and `executor.ts`, but job code does not aggregate their events. The existing telemetry `rollups()` can sum all roles, yet is not wired into job results.
2. **Failed attempts can be recorded as free.** `scheduler.ts:108–114` records `costUsd: 0` when an attempt throws. `job.ts:139–142` can throw after model costs were incurred. Every charged attempt must count before trustworthy cost comparisons or budget enforcement.
3. **Cost-per-success is conditional successful-job mean, not amortized total spend per success.** `combine.ts:141–145` sums only passing jobs in this field, and yields zero for no successes. A fixture with a $1 pass and $3 fail produces $1, while total spend per success is $4. Both quantities may be useful, but must be named distinctly; zero successful tasks cannot imply zero cost per success.
4. **Missing costs become zero.** `loop.ts:194`, `combine.ts`, and `plan.ts` use `?? 0`. Runner §4.1 requires missing values remain missing; §6.5 requires API cost for budget enforcement. No model-cost claim should be made from these fields without completeness checks.
5. **Provenance is incomplete and combination is permissive.** CLI initializes framework/image/problem fingerprints as empty objects. `combine.ts:117–128` compares a handful of config fields, not commit, prompt/tool fingerprint, engine, image, or problem hashes. The diagnostic combines differing commits/base prompts and presents the first provenance. `plan.ts` also reads history without checking run validity/provenance and matches only problem/framework, despite its tier claim.
6. **Budget and staged gates need validation.** Scheduler checks budget after a completed job, not each charged turn. CLI does not enforce the documented setup/failure/full-run gates or populate provenance fingerprints. `combine.ts` returns `gate: "ok"` unconditionally. Do not interpret these output flags as proof the gates passed.
7. **Variant evaluation is not wired end to end.** `job.ts:93,105` tests exact equality with `"orchestrate"`, so bracketed variants miss outbound network/model arguments. Server `parseFramework` recognizes only `toolSearch` and `catalog`, not `rerank=none`. A label alone does not prove a candidate actually ran its intended treatment.

These are source findings, except the cost-denominator and mixed-provenance behaviors independently reproduced below. They are baseline prerequisites, not cost optimizations.

## Reproducible diagnostic

Run with Node 24:

```sh
node docs/audits/2026-10-31-cost-accounting-probe.mjs
```

The script calls actual `combineRuns` against synthetic temporary fixtures and asserts the current observations. It is a characterization probe, not an acceptance test endorsing the current behavior. Its dollar values are invented fixtures, not measured costs or estimates. Temporary output stays outside `experiments/runs/`; no experiment output is committed.

Expected observation at the source commit:

- One $1 passing and one $3 failing job: reported `costPerSuccessUsd=1`, mean cost per completed job `2`, total spend per success `4`.
- Different commit/base-prompt runs are accepted together; first commit is retained.

## Required comparison methodology, awaiting applicable approvals

1. Freeze migrated baseline commit, dependency lock, container image digests, tool catalog and prompts, model identifiers/provider, temperatures, limits, repetition schedule, and task/check hashes. Preserve exact candidate commit and configuration. Verify treatment flags are effective, not just labels.
2. Run setup checks and reference solutions in fresh containers. Preserve hidden checks outside job access. Complete the documented dev/failure/setup gates manually and with verified automation; never trust current unconditional flags. Do not tune against reported/pilot outcomes.
3. Compare candidate and baseline on identical task/repetition pairs with the same grading, budget, retry policies and constraints. Interleave order to reduce temporal/cache effects; report cache-hit quantities. Do not relax required work, grading, or quality to reduce cost.
4. Capture every API-reported main, selection, executor, retry, failed-attempt and any tool-internal model charge. Report absent fields as missing. If only token/call/context proxies are available, label them proxies and do not convert them to monetary savings without explicitly documented rates/assumptions. The existing runner requires real cost for paid budget enforcement.
5. Report distinct metrics: total spend / completed terminal jobs (pass or fail); total spend / successful tasks (all failed/retried spending included); mean cost conditional on success; completion fraction; pass rate and confidence interval; correctness/quality/constraint failures by task; calls, tokens and retries by role. Zero successes gives undefined/infinite amortized cost, not a $0 success.
6. Compare paired per-task cost and quality, disclose failed/incomplete attempts and missing charges, report dispersion/uncertainty, and make no claim below the predefined detectable effect. Run size and quality non-regression rules must be fixed before evaluation. A cheap failed solution is not an improvement.
7. Each new optimization approach remains separately branched from the migrated baseline and subject to its planning/approval gates. Current plausible hypotheses, not approved changes: avoid unnecessary reranking via the documented ablation, reduce duplicate read/edit dispatches using existing reference semantics, or reduce repeated static context while preserving full task requirements. Profile first; do not encode benchmark-specific hints.

## Autonomous decision log

- Created only an isolated audit branch; no main/master edits.
- Installed locked npm dependencies with lifecycle scripts disabled, in this worktree. Used a temporary cache after the environment's default npm cache path failed. No credentials read or changed.
- Used Node's supported `--import tsx` test loader after the `tsx` command wrapper could not create its IPC socket; no permissions or security settings changed.
- Retained all approval/status records unchanged despite inconsistencies.
- Historical HANDOFF results (including ~6x cost) are historical claims only; raw run artifacts are not tracked in this checkout and were not independently reproduced.

## Validation record

See final section below for completed commands and environment limits.

- Environment: Dot's own shared Linux x86_64 cloud computer; Node `v24.22.1`, Python 3.12, git. No Docker executable/socket found. No delegated Codex Cloud environment used.
- `npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/aiw-baseline-npm-cache --fetch-retries=0 --fetch-timeout=15000`: PASS, 279 locked packages installed. Initial default cache attempt could not create `/home/agent/.npm`; a status-poll approval error was retried only after parent supplied new authorization context, then actual outcome was checked before installation retry.
- Python local venv: `python3.12 -m venv packages/tools/.venv`; install `packages/tools/python/requirements.txt`: PASS. No system-wide package/configuration change. Direct dependency versions are pinned; pip resolved transitive `pytoolconfig 1.3.1`, `typing-extensions 4.16.0`, `packaging 26.3`, `platformdirs 4.14.2` (record for reproduction).
- `node --test packages/runner/test/combine.test.ts packages/runner/test/plan.test.ts`: PASS, 16 tests.
- `npm run typecheck`: PASS.
- `npm test`: BLOCKED at the tsx CLI's IPC socket (`listen EPERM`), before package tests execute. Viewer script explicitly says it has no tests.
- Supported loader invocation, same package test files: PASS, **302 tests, 0 failures, 0 skips**:

```sh
mkdir -p /tmp/aiw-baseline-cache
XDG_CACHE_HOME=/tmp/aiw-baseline-cache AIW_VENV="$PWD/packages/tools/.venv" \
  node --import tsx --test packages/core/test/*.test.ts packages/llm/test/*.test.ts \
  packages/runner/test/*.test.ts packages/server/test/*.test.ts \
  packages/telemetry/test/*.test.ts packages/tools/test/*.test.ts
```

The first loader run without a venv passed 241 and skipped 61. Adding the venv but not the writable cache passed 296 and failed 6; Jedi's default cache path was read-only and some refactor tests also failed. Setting `XDG_CACHE_HOME` to a writable temporary directory made all 302 pass without source/test changes. This environment setup is required for faithful reruns.

- `node docs/audits/2026-10-31-cost-accounting-probe.mjs`: PASS, reproduces both diagnostic observations (not correctness acceptance).
- `git diff --check`: PASS.
- Not run: isolated-vm engine tests (native optional dependency lifecycle disabled), viewer UI checks/build, Docker problem self-checks, paid model evaluations, migrated workflow, or candidate comparisons. The passing unit suite is not an end-to-end evaluation or cost baseline.

## Next safe steps

Finish framework inspection/migration under its gates. Before any cost claim, fix and regression-test accounting, attempt retention, provenance, variant dispatch, and staged gate enforcement as applicable ordinary correctness work; preserve existing required approval states. Establish a real baseline only when Docker-equivalent required execution and authenticated model access are available and paid execution is authorized. Keep historical 6x figures and synthetic fixtures out of measured result tables. Candidate plan changes remain awaiting their required approval; no optimization implementation is authorized by this audit document.
