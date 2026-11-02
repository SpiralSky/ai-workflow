# Selector reuse + shared development gates — 2026-11-02

Development integration only; the selector-reuse plan remains draft.

## Authority and decisions

User authorization: “Yes, this authorizes merges between the development branches only.”
The ordinary two-parent merge combines candidate `c7255baa50b7b6644c7fb5036264033e97ef299b`
with reviewed shared framework `7b4980f3806db5ad2a7cf7ba28ab11c303caad08`, at common base
`67b42ae04153079e84b1fdacdd0082a2e623ffc8`. No hotpath treatment enters this branch.

- Keep the task-scoped reuse wrapper opt-in and unconnected to engine/runner revisions.
  All treatment source and packaged bundle bytes are unchanged from the candidate parent.
- Resolve the sole conflict, the development allowances, as a unique union of exact runtime
  paths (**121**). Preserve all original `before` states, inventories and specification bodies.
  Existing historical followups remain; additive integration metadata records both parents.
- Retain every shared gate, strict TAP/Python complete-coverage check, fixture admission before
  expensive work and exact clean-codebase checks unchanged from the shared parent.
- Rebuild the actual-source server bundle and run its freshness check; both succeeded with
  no tracked bundle-byte delta. No generated artifact was text-merged.
- Use existing materialized dependencies with this checkout's own workspace links and the
  verified sibling Python venv; no install/download or dependency-file change.

Read-only review cleared the staged composition; reviewed staged diff SHA256:
`2af3ad2bd408343b9435f983198e6d91484badbd3f73dbb4f988984e120e2aaf`.
The only subsequent changes are this record, the handoff and verification metadata.

## Actual composed verification

Focused selector/classifier suite: **34/34 passed**, zero failures/skips.
Preservation and Specplane validation passed: 19 specification bodies, 6 preserved files,
121 exact runtime allowance paths, historical inventories verified; 258 existing warnings,
zero validation errors. Plans remain draft/action none. An initial manual preservation CLI
invocation omitted `SPECPLANE_CLI` and stopped at that setup requirement; rerunning with the
existing verified local distribution succeeded. No source or assertion change was needed.

One composed broad attempt, exit 0:

```sh
AIW_TEST_CONCURRENCY=1 \
AIW_VENV=/workspace/scratch/8329530da55a/repos/ai-workflow-baseline/packages/tools/.venv \
node scripts/test-cloud.mjs > /tmp/aiw-selector-reuse-composed-full.log 2>&1
```

| Stage | Tests passed |
|---|---:|
| Top-level entry/preservation scripts | 53 |
| Nested synthetic native contract | 16 |
| core | 196 |
| llm | 70 |
| runner | 296 |
| server | 22 |
| telemetry | 17 |
| tools | 104 |
| viewer | 1 |
| **Package subtotal** | **706** |
| **Node total** | **775** |
| Python design, normal | 12 |
| Python design, optimized `-O` | 12 |

All Node groups have zero failures, cancellations, skips and TODOs. Both Python groups have
zero failures, errors, skips, expected failures and unexpected successes. Strict standalone
native and final package TypeScript checks passed. Actual relocated native/tier-L resource
and package freshness checks are included, not a Docker/CI claim. Node 24.22.1; Python 3.12.14.
Focused tests are subsets, not extra aggregate cases. Full log SHA256:
`eb20574a963c5b9098c0ee6cfc6a75281201a2c14ae8b07fb7c14a13ed09126c`.

This is local functional acceptance, not live model/task success, prompt-cache evidence,
latency or monetary savings, native assignment results, quota/free-billing evidence, deployment,
plan approval or a default/final merge. Publication remains parent-owned.
