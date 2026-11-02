# Bounded hot-path candidate — 2026-11-02

User direction: "Keep working on and improving it" (ai-workflow only).
Isolated branch `dot/hotpath-prototype-20261102`, starting base `67b42ae04153079e84b1fdacdd0082a2e623ffc8`.

This candidate completes the unfinished `orchestrate[hotPaths]` path without enabling it
by default. It is a competing idea, not an asserted improvement. The exact proposed
limits, safety assumptions, and API adaptations are in
`plans/2026-11-02-hotpath-prototype/spec-gaps.md`; the plan remains draft.

Parent-reported focused validation: 80/80 seed tests, 65/65 integration/index/variant/executor
tests, and typecheck pass. Specplane validate passes (257 warnings), with the plan remaining
draft/action none. Exact core after states are refreshed; preservation tamper tests await
parent staging and bundle refresh. These are functional checks only. No provider evaluation,
benchmark outcome, paid resource, default switch, approval, or merge is claimed.
Preservation is maintained via explicit after-state entries only; original migration
inventories and historical before states remain untouched. Bundle/full-suite verification
is parent-coordinated after local focused validation.

Final combined focused command: `node --import tsx --test packages/core/test/hot-path-index.test.ts packages/core/test/hot-path-seeds.test.ts packages/core/test/variant.test.ts packages/core/test/orchestrate.test.ts packages/core/test/executor.test.ts` — **149/149 pass**. Final `tsc -p tsconfig.json --noEmit` passes. The legacy planner static-snippet bypass was removed after read-only audit; only index-selected snippets reach planner-driven executors.

## Review corrections and example limits

Independent review found two completeness defects: edit verification omitted upstream
`runTests.truncated`, and checking a warning-only visible prefix could obscure errors
outside that prefix. Both are corrected: summaries retain upstream truncation; locally
omitted counts are explicitly named `omittedVisible*`; check results distinguish
`no-visible-error` from `clean`. The check counts use the actual sidecar severity-count
map (absent severities have zero count). Three additional execution regressions cover
30 actual failures/15 returned/5 summarized, 40 visible warnings hiding one error,
and zero visible failures/references with upstream truncation.

These are state-slot examples that the executor must adapt, not automatic actions or
universal filename/error support. Paths are relative, at most 512 characters, reject
absolute/drive/backslash/control characters and `..` segments. Located basenames accept
only ASCII letters/digits/underscore/dot/dash; symbol names are ASCII identifiers.
Narrow test targets require a `.py` path and optional identifier-like `#Class.method`.
Patterns are capped at 256 characters, edit strings at 8000, whole explicit shell commands
at 4000 (no interpolation), and requested read windows at 80 lines. Recovery recognizes
the implemented ENOENT/edit/cycle error forms; unrelated errors propagate. Other legal
filenames, languages, identifier forms, and error formats may need adapted examples.

Runner/server audit found no stale hotPaths unsupported assertions. Runner canonical
IDs preserve the treatment separately; compare remains baseline/branch-only/orchestrate.
Static provenance hashes configuration separately, all tracked runtime source (including
every seed), and every bundled artifact byte; the server build imports the seed catalog
through buildFramework. Added runner tests exercise canonical distinctness and source,
configuration, bundle and entry hash sensitivity using only local authored fixtures.

Final reviewed focused results: core 149/149; runner config/provenance and server variant37/37. All seed/record workers stopped editing. Exact seed/source files:

- `packages/core/src/framework/build.ts`
- `packages/core/src/framework/variant.ts`
- `packages/core/src/orchestrate/executor.ts`
- `packages/core/src/orchestrate/planner-tools.ts`
- `packages/core/src/orchestrate/hot-paths/catalog.ts`
- `packages/core/src/orchestrate/hot-paths/check-errors-read.ts`
- `packages/core/src/orchestrate/hot-paths/command-nonzero-summary.ts`
- `packages/core/src/orchestrate/hot-paths/edit-ambiguous-reread.ts`
- `packages/core/src/orchestrate/hot-paths/edit-missing-reread.ts`
- `packages/core/src/orchestrate/hot-paths/edit-then-narrow-test.ts`
- `packages/core/src/orchestrate/hot-paths/find-files-empty-widen.ts`
- `packages/core/src/orchestrate/hot-paths/grep-empty-widen.ts`
- `packages/core/src/orchestrate/hot-paths/index.ts`
- `packages/core/src/orchestrate/hot-paths/move-cycle-diagnose.ts`
- `packages/core/src/orchestrate/hot-paths/read-not-found-locate.ts`
- `packages/core/src/orchestrate/hot-paths/read-truncated-range.ts`
- `packages/core/src/orchestrate/hot-paths/rename-zero-references.ts`
- `packages/core/src/orchestrate/hot-paths/test-failure-summary.ts`
- `packages/core/src/orchestrate/hot-paths/types.ts`

## Hidden prompt-set fingerprint alignment

Architecture/runner §9 explicitly includes the hot-path snippet set in hidden-text
fingerprints. Global source/bundle hashes were not a substitute. The shared core
`hotPathCatalogFingerprint` now hashes canonical id, description, outcome, tools and
code for the reviewed set. The executed server reports its own compiled catalog hash
under `runtime.prompts["hot-paths"]`; static host provenance independently computes the
expected catalog hash. Existing exact equality for every markdown prompt is retained.
Enabled hot paths additionally require that both recorded and observed values equal
the current reviewed hash, rejecting even matching omission/corruption in both maps.
The key is metadata for all modes, allowing mixed-mode provenance comparison without
changing default model prompts, exposed tools, or treatment selection.

Focused mutation tests cover every catalog field and ordering; attestation tests reject
missing/mismatched hashes before job attestation. A compiled-server listTools-only test
checks the actual rebuilt artifact with `orchestrate[hotPaths]` and the host broker,
without invoking a model or any host tool. Initial source-focused checks: 23/23 pass;
typecheck passes. Final compiled-artifact check awaits the parent rebuild.

Additional source path: `packages/core/src/orchestrate/hot-paths/fingerprint.ts`;
exports: `packages/core/src/orchestrate/index.ts`; observation:
`packages/server/src/server.ts`; expectation/attestation:
`packages/runner/src/provenance.ts`.

## Final reviewed local evidence

The first semantic review found two genuine completeness bugs: edit verification
lost upstream failed-test truncation, and a truncated diagnostic prefix could say
error:null even though full counts reported hidden errors. Both were corrected;
omission counts now explicitly describe visible lists, upstream hints survive,
and no-visible-error is distinct from clean. Independent seed/index rerun87/87
passed. No reduction of grader checks was used to resolve either finding.

Parent architecture review additionally required the separately observable
hidden-text catalog fingerprint from runner §9. Core hashes all five snippet
fields; compiled server reports its own catalog fingerprint; host computes its
expected value, and enabled attestation rejects absent/mismatched hashes before
model requests. The full existing markdown-prompt map comparison remains.
Independent final index/provenance21 and config19 tests passed; parent compiled
server/source fingerprint checks24/24 passed without model/host-tool calls.

Full final common-serial verification: **696 package +28 script tests**, zero
skips, typecheck, original-spec/runtime preservation and exact regenerated bundle
freshness pass. Actual local relocated native/tier-L checks are included, on
Node24.22.1 with the existing Python tool venv. Target-container Node22 validation
is separate and not yet claimed. Plans stay draft and candidate stays off by
default; no task-success, latency, token or monetary improvement is measured.

The comparison's 'fixed60' name is shorthand for the existing frozen10-task ×3
framework-family ×2-tier design, not a claim that60 live jobs ran. A hot-path
ablation must predeclare the on/off treatment and preserve the same task/check
coverage and accounting; it is not silently added to the classifier comparison.
Snippets can add prompt text and exec/write-capable registered tools. The bounds
are snippet/tool counts, not hard token/cost ceilings; normal usage/transcripts
and handoff IDs/final tools expose the added work for later measurement.
