# Experiment registry — 2026-11-02

## Authority and comparison rules

The user explicitly permits development-branch merges (2026-11-02), native dot assignments,
local tests, and clearly labeled relative-price estimates. Default-branch merges and PR approvals
remain human-only. Specifications/plans remain draft/review; merging development code is not
approval. No external model/API spending, credentials, Codex tasks, branch deletion or force-push
is authorized by this development workflow.

`dot/dev-framework-20261102` is the shared infrastructure baseline. Propagate its exact reviewed
commit into each experimental branch independently. Shared admission, grading, accounting and
coverage cannot be relaxed to help a candidate. Preserve all attempts, including failed and
incomplete runs. A repaired implementation starts a new identified version; do not rewrite history.

Native model identity, hidden context, input/output tokens, cache hits and monetary charges are
unverified. Common visible-input/output UTF-8-byte proxies and hypothetical cache scenarios may
compare visible payload burden, not actual total model price. Report ranking sensitivity and
unknowns. Native artifact tests are not a live orchestrate or fixed60 model campaign.

## Deduplicated hypothesis families

| ID | Idea | Implementation | Current disposition | Evidence needed |
|---|---|---|---|---|
| classifier-filtering | Replace generic LLM reranking with dedicated classifier filtering | Optional implementation included in historical base `67b42ae`; Jev/Microsoft/Perplexity arms are one family | Deferred effectiveness evaluation; not rejected | Matched real classifier/control outcomes, recall/recovery/task success and accounting; native substitutes cannot establish named-model quality |
| selector-reuse | Reuse an eligible unchanged selection decision | `dot/selector-reuse-20261102`, library only; Task does not supply reuseScope | Active prototype, not an exercised runner treatment | Exact eligible repeat opportunities and invalidation/rejection reasons; conservative wiring; real task completion |
| hotpaths | Bounded retrieval of reusable recovery-code examples | `dot/hotpath-prototype-20261102`, opt-in `orchestrate[hotPaths]` | Inactive reference: current two-snippet policy not promoted after bounded native pilot; family refinement remains possible | See native-hotpath-pilot-v2: both arms 2/2 tasks and97/97 checks, snippet payload proxy higher in all9 scenarios; no full-orchestrate conclusion |
| static-context/type-interning | Intern exact duplicate declaration types without dropping information | `dot/declaration-type-interning-20261102`, opt-in initial declaration renderer | New independent candidate, focused tests/survey pass; aggregate and native quality evaluation pending | Exact expansion/default preservation; complete task success; declaration bytes are not tokens or dollars |

No candidate has measured full-project task success or monetary savings supporting a global
effectiveness ranking. The current hotpath policy is parked only on the bounded presentation pilot
recorded in [the curated results](../dot-progress/native-hotpath-pilot-v2.md); its branch is retained.
Unmeasured hypotheses are not classified as experimentally disproven.
`rerank=none` is an existing control, not a new algorithm. BM25 index caching, findTools expansion,
branch-only lazy toolSearch, reference passing and replaceSymbol already exist; do not relabel
these as new ideas. Diagnostic instrumentation may enable a new experiment, but is not itself
measured cost reduction.

## Shared branches

- `dot/design-contract-hardening-20261102`: frozen-design validation integrity.
- `dot/test-resource-isolation-20261102`: explicit serial scheduling, unchanged assertions.
- `dot/fixture-admission-20261102`: shared fixture/grading/build-context integrity.
- `dot/dot-native-experiments-20261102`: bounded one-way artifact-grading utility, not a provider.
- `dot/idea-refinement-progress-20261102`: research/progress documentation.
- `dot/native-comparison-harness-20261102`: shared matched native-artifact evaluation under development.

## Historical branch inventory

Names below omit `dot/`. These branches are retained unchanged as history, not renamed or deleted.
"Historical-integrated" means content included via verified snapshots/replays, NOT merged Git
ancestry. None of the 26 listed old local tips is a direct ancestor of historical base `67b42ae`.

| Branch group | Disposition |
|---|---|
| baseline-audit-20261031; progress-20261031 | Historical records, not candidate implementations |
| evaluation-correctness-20261031; variant-correctness-20261101; accounting-correctness-20261101; overlay-correctness-20261101 | Historical-integrated shared correctness |
| migrate-specplane-experimental-20261101 | Historical-integrated framework |
| ignore-hygiene-20261101; migration-ignore-publication-20261101; signin-ignore-publication-20261101 | Historical-integrated hygiene/publication snapshots of one family |
| failfast-campaign-20261101 | Historical-integrated evaluation control, not faster task solving |
| openai-plan-signin-20261101 | Historical-integrated provider feature; live behavior/quota not established |
| runtime-coherence-20261101; runtime-packaging-readiness-20261101; sidecar-shutdown-20261101 | Historical-integrated runtime fixes |
| provenance-readiness-20261101; all-provider-host-broker-20261101 | Historical-integrated security/provenance |
| direct-deepseek-20261101 | Historical-integrated provider feature; comparisons unmeasured |
| typed-classifier-reranker-20261101; direct-typesafe-classifier-20261101 | One integrated filtering implementation family; effectiveness unmeasured |
| openai-signin-review-20261101; classifier-review-20261101 | Historical-integrated composition checkpoints, not additional ideas |
| classifier-evaluation-plan-20261101 | Deferred protocol; five arms are not five executed algorithms |
| full-success-readiness-20261101; evaluation-ready-20261101 | Unintegrated expanded fixture dependency; not weak optimization ideas |
| docker-ci-20261101 | Historical CI transport with partially replayed runtime fixes; do not wholesale merge old fixtures/runtime |

Read-only audit verified exact tree equality for local/publication snapshots:
`b810601` / `91afef3` (classifier), `9ed722f` / `c1506aa` (DeepSeek),
`42ff9e5` / `f3bc9a2` (host broker), `179ac10` / `0733fc0` (runtime/provenance).
Published counterparts are ancestors of `67b42ae`. Project progress documents record the
intervening replays; later source differences do not invalidate their historical inclusion.

## Archiving and promotion

Use this registry to mark a branch inactive, retaining its ref, commits, evidence and rationale.
Separate historical duplication, blocked measurement, implementation failure and disproven
hypothesis. A small exposed artifact pilot cannot establish broad superiority or justify deleting
an alternative. Promote for further refinement only when required work is preserved and logs show
that the intended mechanism actually ran. Compare new proposals against this registry first.

Expanded full-success fixtures remain on `dot/evaluation-ready-20261101` (`b1190e3`); modern shared
runtime has not incorporated them. Compose their pinned fixture assets separately, preserving
original inventories and applying fresh admission. Native artifact success is not the 10-task ×
3-framework × 2-tier full-success gate. No evaluation cells are silently dropped or counted passed.
