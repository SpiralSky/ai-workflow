# Attempt cost correctness — 2026-11-01

## Scope and provenance

Branch `dot/accounting-correctness-20261101` starts at variant-correctness commit `f725502210e25a49b57fb6d62d5666291adab17c`. Isolated worktree: `../ai-workflow-accounting`. This is an evaluation prerequisite, not a post-migration optimization candidate. No approvals, plan finalization, merges, remote pushes, model requests, production configuration changes or Docker runs.

The user authorized reversible experimental technical/schema decisions. Objective is full task success first, then cost per task. No success-rate or monetary improvement is claimed.

## Defects addressed

- Job cost previously counted only the main loop, omitting selection/executor telemetry.
- Failed attempts were assigned zero; exhausted failures could return before updating final run totals.
- Retry archive creation made folders but did not move old event files, allowing repeated attempts to append into one log and double-count/reuse IDs.
- Server created a new reporter/counter per request; server IDs collided across successive tool calls. Runner also put correlation metadata inside arguments rather than MCP request `_meta`.
- Missing cost fields were zero-filled in loop/report/projection; nullable costs would crash existing viewer formatting.

## Autonomous technical decisions

1. Completed attempt costs come only from its event log, never the sum of event charges plus loop totals. All main, selection and secondary turn costs count. Telemetry schema/role errors, negative/missing costs, truncated records or duplicate turn IDs invalidate completeness; duplicate IDs are not counted again. Known valid charges remain a lower bound.
2. Normal attempt accounting occurs after session closure/container removal and the runner sink closes. Failed shutdown marks accounting incomplete. Calls interrupted before an API usage response, or failed orchestrate `do` calls with potentially unobserved nested requests, cannot be asserted free. An unexpected attempt error salvages a partial-log lower bound but always marks it incomplete.
3. `AttemptFailure` carries accounting through error paths. Scheduler adds each attempt once, including exhausted failures and already-dispatched concurrent work. Unknown accounting stops further dispatch/retries and marks the monetary-budget run invalid. Budget is checked after every attempt, not only successful jobs.
4. Earlier attempts' raw files are moved to `attempts/<n>/` before retry; archives are never overwritten. The current attempt uses a fresh event file and its correct attempt number. No historical evidence is deleted.
5. The server shares one reporter/sink for its process lifetime and derives request scopes with `fromMeta`. It receives proper MCP request correlation metadata. A real local stdio integration test exercises two branch tool requests and verifies unique IDs and both runner parent references, without any model calls.
6. Complete persisted totals can be `null` when unknown. Separate `knownCostUsd` / `knownCostUsdAllAttempts` and `costIncompleteReasons` fields retain lower bounds and explain uncertainty. This widens existing TypeScript cost fields without asserting a new approved specification status. Format version remains 1: complete numeric records remain accepted, while incomplete nullable records implement the existing missing-cost principle. Older external consumers expecting unconditional numbers need updating before using this branch's incomplete records.
7. Reports and history projections do not substitute zero for missing cost. The existing legacy conditional-success metric is not redefined. Cost-per-task (`meanCostUsd`) becomes unknown if any constituent cost is unknown. Viewer summary, tabs, job cells and run sidebar display unknown rather than crashing or adding null as zero. Derived partial-event jobs never claim complete costs.

## Limits and remaining prerequisites

- A complete event log means complete **observed successful-call** charges, not an independent provider-invoice reconciliation. A provider can bill a request whose response never arrived; this patch explicitly labels that uncertainty. There is no egress-proxy ledger yet.
- Monetary-budget checks occur at attempt boundaries; a long or concurrent in-flight attempt can overshoot before it finishes. Per-turn/proxy streaming enforcement and preflight proof that the provider reports cost remain necessary before treating live budgets as strict bounds.
- Server/process shutdown cannot prove that every external provider request is settled. Interrupted/failed paths are conservative; actual Docker lifecycle/failure behavior was not exercised here.
- Cost rollups are not full task-quality evaluation. Provenance completeness, paired-statistics validity, benchmark grading and full task success still require separate verification.
- Existing unrestricted Docker bridge transport remains unchanged and is not the specified internal egress proxy.
- Viewer production build passes, but its standalone TypeScript configuration has pre-existing missing Node type/CSS module declaration issues. With `--types node`, the CSS side-effect-import declaration remains. No unrelated configuration changes were made.

## Reproduction

Locked packages installed with npm lifecycle scripts disabled and the existing temporary npm cache. Tests use local temporary fixtures and scripted attempts only. Full suite command:

```sh
XDG_CACHE_HOME=/tmp/aiw-baseline-cache \
AIW_VENV=/workspace/scratch/8329530da55a/repos/ai-workflow-baseline/packages/tools/.venv \
node --import tsx --test packages/core/test/*.test.ts packages/llm/test/*.test.ts \
 packages/runner/test/*.test.ts packages/server/test/*.test.ts \
 packages/telemetry/test/*.test.ts packages/tools/test/*.test.ts
```

The npm test wrapper is attempted separately; its tsx CLI requires prohibited Unix-domain IPC. The supported Node loader runs the same test files without changing permissions.

## Verified results

- Root `npm run typecheck`: passed.
- Standard `npm test`: attempted and blocked by the tsx CLI IPC restriction before package tests, as at baseline.
- Final full suite above plus `packages/viewer/test/*.test.ts`: **371 tests passed, 0 failed, 0 skipped**.
- The new viewer server-rendered regression test passes with null costs; the test supplies React for the root Node loader's classic JSX mode, without changing application behavior.
- `npm run build --workspace=@aiw/viewer`: passed (indexer and Vite production build). No browser-based visual/interaction QA performed.
- Existing synthetic diagnostic probe and `git diff --check`: passed.
- Local stdio MCP session test: two actual branch requests execute `printf fixture`, create unique server event IDs, and retain both supplied parent references. No model endpoint involved.
- No paid evaluations, Docker/grading runs, optional native isolated-vm tests, complete benchmark-success claims or monetary savings measurements.
