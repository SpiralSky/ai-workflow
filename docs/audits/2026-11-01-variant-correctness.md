# Effective framework variant dispatch — 2026-11-01

## Branch and authority

`dot/variant-correctness-20261101` is based on `b2e781f83976e6807f341debea216dcc56a6ff5d` (evaluation correctness), in isolated worktree `../ai-workflow-variants`. It is separate from migration and is not a post-migration optimization candidate.

User authorized autonomous parallel experimental choices and technical fixes, with final merges reserved to the user. Objective is full task success first, then cost per task. No approved/finalized plan or spec statuses have been fabricated, and nothing has been merged, pushed, or deployed.

## Existing requirement and defect

Runner architecture §2 defines canonical framework variants, including `orchestrate[secondary=2]`. Orchestrate architecture §4 defines `rerank: llm|none`, default llm; feature §10.2 defines `catalog=N` and `branch-only[toolSearch]` treatments. Core already implements rerank and executor turn limits.

Previously runner networking/executor launch arguments matched only the exact string `orchestrate`. Bracketed variants did not get executor settings. Server parsing silently discarded rerank, secondary, unknown keys and malformed numeric suffixes, so reported treatment labels could disagree with executed behavior.

## Changes and autonomous decisions

- Added one shared parser/canonicalizer used by runner and server. It accepts only supported effective keys, rejects duplicates, malformed syntax/numbers, incorrect framework/key combinations, and unknown keys.
- Reject `hotPaths` and `executor=calls` explicitly because core says they are not implemented. Accept `executor=branch`, the existing executor, rather than claiming to implement new behavior.
- Canonicalization sorts known keys. Old tests that accepted invented foo/a/z treatments were changed to assert sorting on real keys; rejecting unknown treatments is intentional, not backward-compatible silent execution.
- Runner classifies by parsed framework kind before creating job artifacts or launching containers, so all orchestrate variants receive executor model/endpoint/cap arguments.
- `secondary=N` overrides the run-wide cap for that explicitly labeled treatment. `rerank=none|llm` overrides the corresponding core option. Defaults remain unchanged when keys are absent.
- Core uses these explicit keys at the selection and executor construction boundaries. Tests check actual fake-model request counts, not merely labels or parsed options.
- No real API requests, paid runs, Docker invocation, network/security configuration changes, or credential persistence were performed.

## Important remaining limits

The existing runner's unrestricted Docker bridge transport is preserved for parity between bare orchestrate and its variants. This does **not** implement the architecture's internal egress-proxy network. Do not claim container isolation or safe live evaluation from this patch. Code review and tests exercise launch data only.

Unknown treatment rejection does not implement new candidate algorithms. Accounting completeness, full provenance fingerprint generation, full benchmark task success and cost measurement remain separate prerequisites. Fake-LLM tests establish dispatch correctness only, not quality or monetary savings.

## Validation

Commands and final results are appended below. Unit tests include parser rejection coverage, runner executor classification, real core selection/turn-cap behavior with scripted clients, and CLI fail-fast checks. No specification bodies changed.

- Locked dependencies: `npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/aiw-baseline-npm-cache --fetch-retries=0 --fetch-timeout=15000` succeeded (279 packages). No lifecycle scripts or native engine installation.
- `npm run typecheck`: passed.
- Focused parser/core-treatment/runner tests: 45 passed. CLI fail-fast subprocess tests: 3 passed.
- `npm test`: attempted; blocked before package execution by tsx CLI Unix-domain IPC `EPERM` (same environment limitation as baseline).
- Equivalent full suite: **353 tests passed, 0 failures, 0 skips**, using:

```sh
XDG_CACHE_HOME=/tmp/aiw-baseline-cache \
AIW_VENV=/workspace/scratch/8329530da55a/repos/ai-workflow-baseline/packages/tools/.venv \
node --import tsx --test packages/core/test/*.test.ts packages/llm/test/*.test.ts \
 packages/runner/test/*.test.ts packages/server/test/*.test.ts \
 packages/telemetry/test/*.test.ts packages/tools/test/*.test.ts
```

- `git diff --check`: passed.
- Not run: Docker end-to-end evaluation, paid-model benchmarks, optional isolated-vm engine integration, viewer UI. No measured task-success rate or cost improvement is claimed.
