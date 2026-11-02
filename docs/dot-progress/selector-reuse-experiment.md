# Experimental design: task-scoped selection decision reuse

Status: **draft prototype**, opt-in only; not a runner treatment. 2026-11-02.

## Hypothesis and distinction

Genuinely repeated selection decisions in one unchanged task might be avoidable. This reuses
only the ordered shortlist and selection stages, never tool outputs or executor answers.
The existing BM25 index cache avoids index rebuilding; it does not avoid repeated reranker calls.
Existing `findTools` lazy exposure/recovery and reference passing remain intact.

Research reviewed 2026-11-02:

- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
  concerns reuse of prompt processing on provider requests. This proposal instead avoids an
  entire eligible selection request; synthetic avoided calls are **not provider cache savings**.
- [OpenAI latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization)
  recommends reducing requests and considering traditional caching. This motivates an experiment,
  not a claim of measured latency benefit: serialization and cloning also cost time.
- [ToolRet, ACL Findings 2025](https://aclanthology.org/2025.findings-acl.1258/)
  finds conventional retrieval strength does not guarantee tool-retrieval quality. Reusing a
  decision does not make it correct; preserve selection-miss auditing and full-task success gates.

## Contract

`createTaskScopedSelector({selector, scope, maxEntries?, maxBytes?})` is exported for explicit
injection via existing `orchestrate.selector`. The existing engine does **not** supply the new
`SelectQuery.reuseScope`; without the exact owned scope object, calls run uncached. No production
wiring is claimed. A future integration must own one scope per Task, advance state/workspace
and reference revisions on every relevant mutation, and dispose at task end.

Key: exact instruction, materialized ordered exclusions, overrides, complete ordered catalog
(including schemas, metadata, routing and return declarations), task id, state/reference revision,
explicit treatment identity, and immutable trusted pipeline identity (classifier model, threshold,
policy, K/N, retrieval/completion versions). Provider/routing changes must advance treatment.
Different wrappers never share entries. Every observed owned-scope revision/treatment transition clears retained entries, including A→B→A and calls that bypass reuse eligibility. Revisions must still never be recycled. Post-await revision
checks reject changed state. Cancellation is checked before lookup and after requests. Parallel
requests are rejected rather than sharing pending results.

Only the trusted built-in classifier boundary can mark a completed, confident, nonfallback
result eligible: valid observed provider/model, finite nonnegative usage, and finite observed
charge or validated existing TypeSafe estimate. The proof passes through internal WeakMaps,
not a caller assertion. Generic LLM/custom selectors fail closed. Config is snapshotted; known
turns/charges stay in their original telemetry. A reporter is required for hits. Unknown accounting/failures/fallbacks are never
promoted to free successes. Failures add a fixed-status nonbilling attachment without raw error content or invented zero charges;
actual charges can remain unknown. Hit attachments use `selectionReuse`, not turn/cacheHit events. Their `sourceTreatment` is a configuration/accounting descriptor, not a unique original decision ID or billed-turn link.

Cache defaults: 32 entries, 1 MiB retained serialized key/value/proof payload budget, LRU eviction. `maxBytes` bounds that serialized retained payload, **not total V8 heap usage or transient clone/serialization memory**.
Inputs/results are defensively copied. Single-use exclusion iterables are consumed once.
Catalog snapshots on misses prevent the existing identity-index cache from hiding in-place
catalog mutations. This deliberately trades some miss-time index reuse for correctness; benchmark
that overhead before integrating. No new retrieval algorithm or index cache is implemented.

## Reproduce (offline, no credentials/provider requests)

```sh
node --import tsx --test packages/core/test/selection-reuse.test.ts \
  packages/core/test/selection.test.ts packages/core/test/classifier.test.ts
```

Predeclared generic corpus: `file text`, `file text`, `search file`, `edit file`, `file text `,
`file text`. Deterministic mocked outputs match exactly: reuse off 6 calls; on 4 calls, 2 hits.
Four synthetic billed turns remain; hits do not repeat usage/cost. These are **synthetic call-count
proxies**, not monetary savings, provider-cache measurements, latency estimates or model/task
success evidence. Unique/mutated queries intentionally miss; no benchmark-task memorization.

Regression coverage: task identity, revisions and in-flight revision race; model/threshold/K/N
pipeline isolation and immutable options; treatment/policy changes; catalog content/schema/order;
generator exclusions; unknown/malformed accounting; provider failure/uncertainty; pre/post abort;
errors; LRU/byte limits; input/result mutation; disposal; overrides; rejected concurrency; fail-closed
unsupported selectors. Defaults remain unchanged. No live eval attempted, and fixed60's full-success
gate remains unchanged. Focused suite passed 34/34 (15 reuse regressions plus 19 existing selector/classifier tests) on 2026-11-02; `git diff --check` passed. Parent owns final broad verification and bundle regeneration.

## Final offline verification and opportunity limit

Parent full verification uses the same explicit serial test-file scheduling as
base67b42ae, via test-resource-isolation harness7bd10f3: 613 package +29 script
tests pass, zero skips; typecheck and regenerated exact-source server artifact
freshness pass, including relocated native/tier-L execution. The first attempted
candidate aggregate stopped at the preservation guard; exact reviewed after-hash
allowances and new-path/tamper checks resolved it without resetting the original
migration inventories or spec bodies. Final independent review passed59 focused
selection/classifier/preservation tests and found no blocker in the stated scope.

A separate bounded opportunity audit found no local experiments/runs data from
which to estimate real duplicate frequency. Task startStep happens before each
selection, and call recording includes findTools. A revision bumped for every
store mutation can therefore eliminate most sequential opportunities; successful
findTools also changes exclusions. The current selector sees raw instruction,
exclusions/override and catalog, not resolved Task/reference state. Do not wire
reuse to stepCount or invent a broad state revision as though it were sufficient.
Measure exact-key repetition and rejection reasons before engine integration.
The synthetic6-to4 result is not evidence of real opportunity or savings, and
this candidate is not promoted as a recommended runtime default.
