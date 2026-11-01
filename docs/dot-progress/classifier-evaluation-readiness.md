# Classifier comparison: fair offline readiness design

**Status: draft, not campaign-ready. No model quality, live output, spend or savings measured.**

## Provenance and isolation

- Branch `dot/classifier-evaluation-plan-20261101`, worktree `ai-workflow-classifier-evaluation`,
  based on final composed runtime `9ed722f2b333a881ae9f3486765dc66ff6042631`.
- Full-fixture branch remains separate: `dot/evaluation-ready-20261101`, source
  `b1190e39d7568040960754d96f325b0edd0f4224`. Its frozen
  `docs/audits/evidence/2026-11-01-fulfil-matrix.json` digest is recorded in the design JSON.
  This runtime branch does **not** contain that complete authored fixture set. No fixture asset
  is copied here and no result from the fixture branch is relabeled a classifier result.
- Parent research `research/decision-models-2026-11-01.md` informs candidate names/API contracts.
  Requested shortlist is Jev1.14, Microsoft-Decision-1, Perplexity Decider Flash V1.2; aliases
  and returned model/provider identities must be recorded, not treated as frozen weights.
- Core source inspected: `selection/{retrieve,rerank,complete,index}.ts`; requirements:
  feature/orchestrate §7/§12, architecture/orchestrate-engine, feature/framework-runner.
  Current default retrievalK20/shortlistN6 and **one-level**, not recursive, `requires` completion
  are preserved. Missing dependencies are diagnosed, not silently changed for one candidate.

## Objective and comparison arms

First achieve every required task with unchanged correctness/quality. Only then compare cost
per required completed task with **fixed full-matrix denominator**, not cost per successful
subset. No candidate wins by stopping on hard tasks, reducing grading or retrying failures away.

| Arm | Only intended intervention |
|---|---|
| llm | Existing chat-based selection reranker |
| none | Existing retrieval-order ablation |
| jev114 | Typed independent relevance questions, typesafe/jev-1.14 |
| microsoft-decision-1 | Same typed adapter/policy, microsoft/microsoft-decision-1 |
| perplexity-flash | Same typed adapter/policy, perplexity/pplx-decider-flash-v1.2 |

`docs/evaluation/classifier-comparison-design.json` names60 cells:10 exact tasks ×2 tiers ×3
framework modes. Each full arm campaign must account for all60 cells; only its20 orchestrate
cells change reranker. Baseline/branch-only40 cells serve unchanged controls, not discarded tasks.
One potential matched block across five arms is300 cells, **not automatic dispatch, a recommended first spend, or authorized expenditure**.
Start serially with mocks; only after separate live-call authority, run one smoke or a tiny
predeclared pilot. Stop all new work on its first terminal error, diagnose/fix, and revalidate
before considering expansion. Pilot outcomes are readiness evidence, not a full-matrix comparison.
Prespecify repeats/seeds and balanced/interleaved arm order after authority; never choose repeats
based on favorable outcomes. Do not silently reuse controls as independent repeated evidence.
A cheaper paired shared-control design would require a new explicit protocol and correlation
reporting before data collection, not post-hoc substitution.

Keep main/secondary models/routes, exact catalog/prompts/source/bundle/image/task/check hashes,
limits, context settings, temperature/seed policy, retrievalK/order, shortlistN, dependencies,
permissions, grading and acceptance equal across arms. Requested and returned provider/model
identities are distinct fields. A provider change for **selection** is the declared treatment;
changing main/secondary provider or tariff window at the same time confounds the comparison.
Direct-TypeSafe selection + DeepSeek primary/estimated accounting therefore needs a separate
matched block whose LLM/none controls use the identical DeepSeek primary settings. Never compare
that block against an OpenRouter-primary billed-dollar baseline as a pure filtering ablation.

## Offline sequence (no provider dispatch)

1. Integrate reviewed classifier source into an isolated runtime branch and compose the frozen
   fixture branch with explicit provenance. Do not claim9ed already supplies those fixtures.
2. Run complete package/script/typecheck/preservation/freshness/ignore checks, then trusted fixture
   broken/reference checks and exact60-cell manifest comparison. Keep all original checks.
3. Require target container engine/artifact/tool preflight from the **exact** composition. Earlier
   Node22 or reference-run evidence on other hashes is useful history, not this result.
4. Replay deterministic synthetic selector contracts only: identical catalog/instruction/exclusions
   gives identical pre-rank candidate pool; stable ties; finite complete probability answers;
   one question per candidate; malformed/missing/duplicate/unknown IDs; zero candidates; no-positive;
   boundary probabilities; cancellation; request/response bound; missing usage; forbidden egress.
   Existing retrieval and completion must be the same functions for every arm. Mocks may supply
   test probabilities but must never be presented as model-produced judgments or recall evidence.
5. Before target observations, choose/freeze threshold using **independent calibration examples**, or explicitly preregister an
   untuned value with its uncertainty caveat.
   Design currently stores null: it is deliberately not ready. Annotate multiple acceptable tool
   paths where legitimate; a reference solution's particular tool use is not the sole gold truth.
   Preserve annotation provenance and ambiguous cases; do not tune on target outcomes.
6. Review phase support before configuration. Phase1 worker uses explicit classifier variant,
   seven-model registry, noul-v1 and threshold>.5≤1; OpenRouter monetary only. Direct TypeSafe or
   DeepSeek-estimated classifier accounting is a later implementation phase, not assumed working.

## Diagnostics required for every selection and task

Record selection ID/task/attempt/role, instruction/context hash (not credentials/hidden checks),
catalog hash, retrieved ordered candidate IDs/scores, threshold/policy/model/request IDs,
returned model/provider, validated scores, pre-completion shortlist and final tool IDs.
Preserve outcome and known costs even when payload is rejected; no silent invisible request.

- **Retrieval coverage/recall**: required relevant-tool alternatives present in candidate pool /
  labeled required alternatives, with denominator and ambiguity published. If absent from pool,
  classifier cannot be blamed for retrieving it nor credited for fixing it. Report raw counts.
- **Conditional rerank recall**: retained relevant tools among relevant tools actually available
  in the common pool; also report end-to-end relevant coverage after completion. Do not hide
  dependency additions or classify them as predicted positives.
- **Omission diagnostics**: distinguish retrieval exclusion, classifier false negative, rank/topN
  truncation, permission/exclusion filtering, missing dependency, and ambiguous gold. Link omissions
  to task failures/recovery without presuming causal proof from correlation.
- **Fallback**: report selection-count numerator/denominator and tasks affected, reason breakdown,
  provider/model, retained tool count and token/cost overhead. Worker contract returns original
  retrieval order before the common topN+completion on any uncertain score, invalid answer or
  no positive; no extra chat-model fallback. `rerankFallback`/reason and `classifierSelection`
  expose policy/threshold/scores or fallback. Transport/unknown-usage failures must not silently
  become free fallback success. Compare fallback-only behavior with none, not an invented judge.
- **Recovery**: record executor escalation/tool refresh/override frequency and all additional
  calls. Initial recall and eventual success differ; evaluate both. Overrides bypass reranking
  by existing design and must be reported separately, not counted as classifier successes.
- **Quality/correctness**: every original task check, regression suite, meaningful requirements,
  security/side-effect constraints and consistent blinded review rubric. Include per-cell evidence,
  not only averages. Passing a unit test or schema validator does not establish task success.

## Cost, fairness and failure protocol

Aggregate main/planner, selection/classifier, secondary/executor and any other role across **all**
attempts, failed calls, retries, recovery and canceled calls. Avoid double counting reverse broker
usage in host and server traces; match request/call IDs. Zero calls is zero only with affirmative
no-dispatch evidence; absent usage/cost is unknown with known subtotal, never zero.

Keep provider-reported monetary cost separate from dated rate-table estimates, tokens and local
compute/wall-time proxies. Use actual cache-hit/miss counters, not assumed cache savings. Show
cache state/order policy, repeated context and provider route; provider prices are not measured
cost per task. Different billing modes are separate strata, never pooled as identical dollars.
End-to-end cost per required task = all recorded campaign spend /60 only when the complete60
required cells succeed and cost evidence is comparable. For repeated blocks use60×repetitions.
For incomplete runs report cumulative spend/known subtotal and missing cells, not a savings winner.
Also show total cost, per-role breakdown, task distribution and uncertainty across prespecified
repetitions. Full success remains necessary but does not waive quality or provenance failures.

On first terminal infrastructure/accounting/task failure, stop new dispatch, cancel siblings,
retain partial results/spend and diagnose before launching anything else. No automatic retry storm.
A repair makes a new versioned candidate; all affected comparator configs/source hashes must be
re-frozen and rerun under the same constraints. Keep prior failures/costs visible; never splice
best attempts into a supposedly pristine full-success run. A common harness/fixture defect must
be corrected for every arm, not exploited by one. Do not weaken tests to make a task pass.

The authored suite is already exposed during development. Label results as this fixed regression
suite, not external/generalization holdout. No benchmark-specific shortcuts or reference/check
content in model prompts; hashes may attest checks without disclosing their bodies to providers.

## Autonomous decisions vs approval

- Autonomous reversible decision: plan fixed five arms with shared selector semantics and explicit
  null threshold rather than inventing a tuned value. Rationale: prevents accidental hidden tuning.
- Autonomous decision: keep whole60-cell campaigns rather than prune unchanged controls silently.
  Rationale: transparent full-task accounting; cost-saving alternatives need explicit preregistration.
- User's experimental-development allowance permits this isolated design only; no user plan approval,
  final merge approval or live model-spending authority is fabricated. All plans remain draft.
- Historical cost-per-success language is noted in spec-gaps; latest user full-task requirement
  controls this experiment. Original requirement bodies and historical approvals stay untouched.

## Evidence and outstanding gates

`python scripts/evaluation/check_classifier_design.py --self-test --fixture-root <evaluation-ready>`
passes six structural mutation tests and verifies the actual frozen fixture-manifest SHA and60 keys.
The checker reports zero live calls, no model-quality measurement and campaignReady:false. Without
`--fixture-root`, it says fixtureManifestVerified:false rather than claiming external verification.

No one should dispatch300 requests/cells from this artifact; the machine-readable design is
structural planning material with readyForLiveCalls:false, not a run configuration.

Pending: implementation/phase2 review and exact final integration; full-fixture composition;
threshold/annotations frozen on development-only material; independent privacy/accounting review;
exact target-container preflight; explicit campaign limits/credential/live-call authorization;
matched genuine observations on every target cell. No candidate ranking or savings is available.

Final local checks: six Python design tests pass; actual external frozen manifest hash/cell set
verified; Specplane validate returns valid/zero errors (256 inherited warnings); migration
preservation checker passes unchanged96 runtime deltas; `plan next` reports draft/action:none.
No runtime/package code changed, so the prior9ed547-package/22-script result remains historical
rather than being claimed rerun here. Filesystem/CLI checks are not model quality observations.
