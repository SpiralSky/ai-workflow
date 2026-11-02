# Hotpath shared native-comparison propagation — 2026-11-02

Development integration only; all plans remain draft. User authority: “Yes, this authorizes
merges between the development branches only.” No selector-reuse treatment is introduced.

## Historical first propagation — focused failure retained

Starting hotpath parent: `be28e3c180c933a964dd50629aa869519f5ca8d3`.
First shared parent: `070b490c04f4e9f2bb6e3f8d7f71ec1a75ecf1d5`.
The ordinary merge was automatic. All package, allowance, inventory and specification bytes
were unchanged. Ignored server `dist/node_modules/typescript-api` was present; bundle freshness
and migration preservation passed. Independent read-only review cleared the exact propagation
(staged diff SHA256 `2407614557b7fc1a60f94f67931ca7dd12e787442da8b80e6a2c6c0378dd055f`).

The combined focused method/shared-gate invocation failed **54/55**, not a pass. Its first
`diagnostic-record` reference case, `warning-only-complete`, timed out before any tool call:
`checksRun: 1`, `checksExpected: 45`, `localElapsedMs: 1905.0486110000002`, runtime error
`timeout`. Located-line and all subsequent tests passed. Retained log:
`/tmp/aiw-hotpath-native-harness-focused.tap`. Source was frozen during execution.
No broad candidate suite ran at this stage; no automatic retry, cap/expectation relaxation or
native actor assignment occurred. The shared harness's earlier failed aggregates remain separately
recorded in `native-comparison-harness.md`; the original first aggregate cause is unestablished.

The parent authorized retaining this intermediate ordinary merge before composing reviewed
central follow-up `972fb81e419b948f0ff5ae9ff128132ae64c7d89`. That reviewed follow-up changes
only harness source/docs: portable exact reviewed-tree anchoring and separately reported empty
QuickJS engine setup before artifact deadlines. Artifact timeout stays 1000 ms. Final corrected
composition verification is pending, and this historical intermediate commit is not acceptance.

## Corrected shared propagation — aggregate passed

Intermediate parent `c6e7c6121f37ed14841c964a30abe665f36b3223` preserves the failed focused
propagation above. The subsequent ordinary merge takes exact reviewed shared parent
`972fb81e419b948f0ff5ae9ff128132ae64c7d89`; no history was rewritten or squashed.
All ten propagated files exactly matched that central parent before evidence-only records.
Independent read-only reviewed staged diff SHA256:
`914662b910d48b4d79df6ea0209f32e46c3302878a13d1559302c83a934bd532`.

The source guard requires the exact reviewed full Git tree in HEAD history, then exact relevant
Git/blob and independent working-byte equivalence plus clean/root/HEAD checks. This supports the
published identical-tree history without requiring a private local commit object. Empty-isolate
setup is separately bounded/reported; the artifact deadline stays 1000 ms, single-use failed
attempts remain consumed, and no expected task result or runtime budget was relaxed.
All package/treatment source, server bundle, allowance, original inventory and specification
bytes remain unchanged from `be28e3c`. Plans remain draft and treatments remain separate.

Corrected focused suite: **58/58 passed** (25 method + 33 shared-gate tests), zero incomplete
outcomes. Bundle freshness and migration/Specplane checks passed with existing materialized
runtime closure. No install, credential, model, Docker or native actor operation occurred.

One corrected composed aggregate was run after the failed historical focused attempt:

```sh
AIW_TEST_CONCURRENCY=1 \
AIW_VENV=/workspace/scratch/8329530da55a/repos/ai-workflow-baseline/packages/tools/.venv \
node scripts/test-cloud.mjs > /tmp/aiw-hotpath-native-harness-corrected-full.log 2>&1
```

Exit 0. **887 Node tests**: 57 entry/preservation, 16 inherited dot-native, 25 portable comparison,
275 core, 70 llm, 299 runner, 23 server, 17 telemetry, 104 tools and 1 viewer. Package subtotal
789. Python design checks: **12 normal + 12 optimized**. Every group has zero failures,
cancellations, skips/TODOs or Python errors/expected failures/unexpected successes. Strict
inherited-native and comparison TypeScript gates plus final package typecheck passed.
Focused cases are subsets, not additional aggregate cases. This is corrected local acceptance,
not first-pass history, model quality, task success, quota evidence or monetary savings.
Full log SHA256: `205645473d23b4ac50113831e388ff63f43d259ce898155c26d997b300cb1598`.

Actual-catalog integration and CLI preflight must run against the subsequent clean merge commit;
those read-only postcommit results are handed to the parent separately so its frozen observed HEAD
is not changed by writing a later evidence commit. Parent owns any pilot, publication and final
approval. Reuse integration pauses while the parent uses the quiet native-pilot window.
