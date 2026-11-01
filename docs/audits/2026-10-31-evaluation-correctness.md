# Evaluation correctness maintenance — 2026-10-31

This is a bounded bug fix against existing requirements, not a cost optimization or a migrated baseline. No plan/specification approval, finalization, status change, merge, push or model call was performed.

## Branch relationship

`dot/evaluation-correctness-20261031` is based on audit branch `dot/baseline-audit-20261031` at `1a3c06e61e6114c0187b74ce11bf21ac6049697d`, itself based on `origin/master` at `9e0f0826bba1bd08a1684e6a25a92872c40241e9`. Worktree: `../ai-workflow-eval`. This branch must not be represented as a candidate based on the not-yet-migrated framework.

## Authority and autonomous decisions

Feature `framework-runner` §6.6 permits minor bug fixes without treating them as tuning/spec changes. Its §7.1 requires matching provenance; architecture `runner` §8 and `data-formats` §1.1 define the same validation contract. `data-formats` introduction requires readers to reject unknown format versions.

The report combiner previously checked only five configuration fields. It now rejects mismatched commit, runner version, engine, base prompt, framework fingerprints (including extra prompt hashes), and images. It rejects missing required provenance fields rather than accepting identical omissions. Unknown or missing run/job-file versions are rejected before report generation. Existing configuration equality checks now compare object values independent of object-key insertion order.

A prototype-free map preserves special problem identifiers as ordinary data keys. Missing nested configuration/provenance produces an explicit validation error.

Problem metadata may differ between runs. Shared problems must match task hash and limits, including shared problems present only in later runs. The combined report retains the complete compatible problem metadata union instead of silently retaining the first run's subset.

All non-problem provenance fields are compared in full, following the explicit `data-formats` rule. This is deliberately conservative: callers must provide the same framework/image fingerprint maps even when evaluated subsets differ. No new per-overlap exception was invented. The fixture for permitted different problem sets supplies the same image catalog to both runs.

## Changes intentionally deferred

- The term `costPerSuccessUsd` lacks an explicit formula in the existing text. It currently reports mean cost conditional on success, which is not total spend divided by success count. Changing its semantics and zero-success representation needs a documented decision, not an unnoticed metric redefinition.
- Missing costs require consistent optional/null representation across job/run/report types and their consumers. This branch does not invent a persisted contract. Nested and failed-attempt cost accounting remains an identified correctness prerequisite.
- Fingerprint generation/completeness, full run/job schema validation, malformed-record handling, invalid-run aggregation semantics, budget/failure gates, paired-statistics validity and candidate evaluation remain outside this bounded patch. Equal empty fingerprint maps are still possible; equality validation alone is not provenance completeness.
- No monetary baseline or candidate savings have been established.

## Reproduction and validation

- `npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/aiw-baseline-npm-cache --fetch-retries=0 --fetch-timeout=15000`: 279 locked packages installed; lifecycle scripts disabled.
- `npm run typecheck`: passed.
- `npm test`: attempted but blocked before package execution by the tsx CLI wrapper's Unix-socket `EPERM` limitation. Viewer still has no test suite.
- `node --test packages/runner/test/combine.test.ts`: 26 passed, including 16 new provenance/format regression cases.
- `node docs/audits/2026-10-31-cost-accounting-probe.mjs`: passed. Synthetic costs are fixtures, not model-cost measurements. The original probe remains unchanged on the audit branch; here it asserts that mixed commit provenance is rejected, while preserving the remaining denominator diagnostic.
- Full package suite via the supported Node loader is recorded below after completion.

Exact full-suite invocation (uses the audit worktree's pinned local Python environment):

```sh
XDG_CACHE_HOME=/tmp/aiw-baseline-cache \
AIW_VENV=/workspace/scratch/8329530da55a/repos/ai-workflow-baseline/packages/tools/.venv \
node --import tsx --test packages/core/test/*.test.ts packages/llm/test/*.test.ts \
 packages/runner/test/*.test.ts packages/server/test/*.test.ts \
 packages/telemetry/test/*.test.ts packages/tools/test/*.test.ts
```

Final full-suite result: **318 passed, 0 failures, 0 skips**. Typecheck, diagnostic probe and `git diff --check` also passed after the final edits. Tests use local/synthetic fixtures only. Docker/model evaluations, viewer UI and optional isolated-vm native-engine integration were not run; this is not an end-to-end evaluation baseline.
