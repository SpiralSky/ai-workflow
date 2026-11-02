# Hotpath candidate + shared development gates — 2026-11-02

Development integration only; the hotpath plan remains draft.

## Authority and decisions

User authorization: “Yes, this authorizes merges between the development branches only.”
The ordinary two-parent merge combines candidate `7826468308e94add7f668a897a7a74f398c5e117`
with reviewed shared framework `7b4980f3806db5ad2a7cf7ba28ab11c303caad08`, at common base
`67b42ae04153079e84b1fdacdd0082a2e623ffc8`. No selector-reuse treatment enters this branch.

- Keep `orchestrate[hotPaths]` opt-in. All hot-path catalog/index/fingerprint and seed source,
  other core/server treatment source and packaged bundle bytes remain exact candidate-parent bytes.
- Compose provenance imports with shared real-directory/stamp validation and candidate catalog
  fingerprint imports. Preserve admission before bundle subprocesses and other expensive work,
  repeated pre-model admission, exact full prompt-map equality, and the extra enabled-hotpath
  attestation requiring both observed/expected catalog hashes to equal the reviewed catalog.
- The provenance test merge preserves shared synthetic self-check fixture admission and mocked
  grading-exit evidence, plus every existing hotpath source/bundle/config hash and missing/mismatched
  catalog fingerprint regression. No test or assertion was removed or weakened.
- Resolve development allowances as the unique union of exact runtime paths (**140**). Preserve
  all original `before` states, original inventories and specification bodies. Refresh the candidate
  followup's two provenance after-states to actual composed bytes. New integration metadata records
  both exact parents, both original parent after-states and the final after-states for those paths;
  the central historical fixture followup remains intact as historical evidence.
- Keep all shared harness/design/native/fixture gates and exact clean-codebase checks byte-identical
  to the shared parent. Rebuild the actual-source bundle and run `--check`: both succeeded with
  no tracked bundle-byte delta. No generated artifact was text-merged.
- Use existing materialized dependencies with this checkout's own workspace links and the
  verified sibling Python venv; no install/download or dependency-file change.

Read-only review cleared the staged composition; reviewed staged diff SHA256:
`f3e55f1823efabc64ae4c40ff5a32554ae1b19ec87ec89b0b07ce044282289ac`.
The only subsequent changes are this record, the handoff and verification metadata.

## Actual composed verification

Focused fixture-admission/provenance/hot-path index suite: **114/114 passed**, zero failures/skips.
Preservation and Specplane validation passed: 19 specification bodies, 6 preserved files,
140 exact runtime allowance paths, historical inventories verified; 258 existing warnings,
zero validation errors. Plans remain draft/action none. An initial manual preservation CLI
invocation omitted `SPECPLANE_CLI` and stopped at that setup requirement; rerunning with the
existing verified local distribution succeeded. No source or assertion change was needed.

One composed broad attempt, run only after the reuse aggregate terminated, exit 0:

```sh
AIW_TEST_CONCURRENCY=1 \
AIW_VENV=/workspace/scratch/8329530da55a/repos/ai-workflow-baseline/packages/tools/.venv \
node scripts/test-cloud.mjs > /tmp/aiw-hotpath-composed-full.log 2>&1
```

| Stage | Tests passed |
|---|---:|
| Top-level entry/preservation scripts | 52 |
| Nested synthetic native contract | 16 |
| core | 275 |
| llm | 70 |
| runner | 299 |
| server | 23 |
| telemetry | 17 |
| tools | 104 |
| viewer | 1 |
| **Package subtotal** | **789** |
| **Node total** | **857** |
| Python design, normal | 12 |
| Python design, optimized `-O` | 12 |

All Node groups have zero failures, cancellations, skips and TODOs. Both Python groups have
zero failures, errors, skips, expected failures and unexpected successes. Strict standalone
native and final package TypeScript checks passed. Actual relocated native/tier-L resource
and package freshness checks are included, not a Docker/CI claim. Node 24.22.1; Python 3.12.14.
Focused tests are subsets, not extra aggregate cases. Full log SHA256:
`a4c90a8f229d96f3cb85efb248f12c41317c727a80845246f785a869742fe617`.

This is local functional acceptance, not live model/task success, prompt-cache evidence,
latency or monetary savings, native assignment results, quota/free-billing evidence, deployment,
plan approval or a default/final merge. Publication remains parent-owned.
