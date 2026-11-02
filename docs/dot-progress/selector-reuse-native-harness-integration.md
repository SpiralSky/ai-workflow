# Selector reuse + corrected native-comparison gates — 2026-11-02

Development integration only; all plans remain draft. User authority: “Yes, this authorizes
merges between the development branches only.”

## Independent composition and decisions

This ordinary merge combines selector-reuse parent
`729b5cec0918b3a008afdc3f2d719f9f44cf9a89` with shared central
`972fb81e419b948f0ff5ae9ff128132ae64c7d89`. There were no conflicts. All 18 propagated paths
exactly matched the shared parent before these evidence-only records. No hotpath runtime
source or ancestry is introduced: the common comparison helper reads the separately approved
hotpath checkout only for explicitly requested actual-catalog admission, never as a reuse treatment.

All package/treatment source, the server bundle, 121 canonical allowances, original inventories
and specification bodies remain unchanged from the reuse parent. The reuse wrapper remains opt-in,
not engine/runner-wired. Shared source admission retains exact reviewed-tree-in-history, relevant
Git/blob/working-byte equality, known-root and clean-HEAD checks. Empty-engine setup is separate;
artifact timeout stays 1000 ms and failed single-use cells remain consumed.

Independent read-only review cleared the exact propagation. Reviewed staged diff SHA256:
`5918ff7a63179c4bdd3237fc4c789c8b17cd297ba5530f9a6fda88221127edc1`.
The existing ignored server dependency closure, including `typescript-api`, was present;
bundle freshness passed without tracked artifact changes or downloads/installs.

## Actual composed verification

Focused method/shared-gate suite: **58/58 passed** (25 method + 33 shared-gate tests), zero
incomplete outcomes. Preservation/Specplane checks passed: 19 specification bodies, six preserved
files, 121 exact unique runtime paths; plans stay draft. Shared harness historical failed attempts
remain recorded in `native-comparison-harness.md`; this propagation does not recast that history.

One full composed aggregate, started after the parent released the native-pilot quiet window:

```sh
AIW_TEST_CONCURRENCY=1 \
AIW_VENV=/workspace/scratch/8329530da55a/repos/ai-workflow-baseline/packages/tools/.venv \
node scripts/test-cloud.mjs > /tmp/aiw-selector-reuse-native-harness-full.log 2>&1
```

Exit 0. **805 Node tests**: 58 entry/preservation, 16 inherited dot-native, 25 portable comparison,
196 core, 70 llm, 296 runner, 22 server, 17 telemetry, 104 tools and 1 viewer. Package subtotal706.
Python design: **12 normal + 12 optimized**. Every group has zero failures, cancellations,
skips/TODOs or Python errors/expected failures/unexpected successes. Strict inherited-native
and comparison TypeScript gates plus final package typecheck passed. Focused cases are subsets,
not additional aggregate cases. Full log SHA256:
`c7d5bd1b0cb7824ff947555584a706f9a626ec14f6df284e547a0504c2e99a52`.

Only these records and the handoff changed after reviewed source acceptance; final preservation
was rechecked before commit. Hotpath's parent-frozen HEAD was not modified or retested during this
propagation. No model/native actor, provider, Docker or credential operation was performed here.
This is local functional acceptance, not reuse efficacy, task success, monetary/cache savings,
quota evidence, default promotion, deployment or human approval. Parent owns publication and any
separately recorded experiment evidence.
