# Native presentation pilot v2 — 2026-11-02

## Scope and controls

Four ordinary one-way native coding assignments, in frozen AB/BA order: diagnostic off/on,
then located-line on/off. Each worker received only the public task brief plus common coordination
instructions; no prior solution, grader/reference, or result feedback. Source artifacts were copied
unchanged and graded once. No retries, failed cells, omitted checks or best-of selection occurred.
Native isolation was procedural, not a claim that shared files were technically inaccessible.

The actual reviewed HotPathIndex selected snippets; actual compileBranch/QuickJS graded artifacts
against fake in-memory hosts. This exercises example presentation and code adaptation, NOT the full
orchestrate planner/selector/executor loop, tool expansion, named classifier quality or fixed60.
There are two tasks, not 97 independent tasks. All 97 deterministic case checks per arm ran.

Framework source: local central `972fb81e419b948f0ff5ae9ff128132ae64c7d89`;
public equivalent `8fdd339e2b11a78dbe8751ce04501f12d7c39d25`, tree
`99bdbdc1c2af79e6170f587ca106134653e5b6ac`.
Observed frozen candidate: local `aaf815c4e03946dafc25844ffc6550e7de08a8d2`.
Reviewed source anchor tree: `5c048e2715be4dc93bc9b0bcfa354b85f971bc85`.
Catalog SHA256: `bc54edcb9dfd18851a12d18bed3dcf96df28a944246902c6fcd007dd4d9dfce7`.

## Outcomes

| Cell | Required checks passed | Public brief bytes | Source artifact bytes | Observed host attempts |
|---|---:|---:|---:|---:|
| diagnostic off | 45/45 | 3,716 | 1,556 | 34 |
| diagnostic on | 45/45 | 5,835 | 1,444 | 34 |
| located-line on | 52/52 | 6,088 | 2,138 | 58 |
| located-line off | 52/52 | 4,269 | 2,145 | 58 |

Both arms: **2/2 tasks; 97/97 checks**, all required cases. Host-call sequences are fixed by these
contracts, so equal 92 attempts per arm are NOT evidence of optimized tool use. Empty-engine
preparation was performed separately for every grade (237.79–378.03 ms); artifact deadlines stayed
1000 ms. These local times do not measure native thinking or inference latency.

## Relative visible-payload estimate

Observed totals: off input/output **7,985/3,701** UTF-8 bytes; on **11,923/3,582**.
Both arms have 1,092 bytes of exact public-prefix repetition across their two briefs.

The preregistered normalized index is:

`U = inputBytes - 1092 * (1 - prefixWeight) + outputWeight * outputBytes`

| Output-byte weight | Prefix weight 1 | Prefix weight .5 | Prefix weight .1 |
|---|---:|---:|---:|
| 1 | 1.326801 | 1.342819 | 1.356809 |
| 4 | 1.151915 | 1.155644 | 1.158762 |
| 8 | 1.079430 | 1.080600 | 1.081562 |

Values are **on/off ratios**, not dollars or model prices. The snippet arm is higher in all nine
scenarios (approximately 7.9–35.7%). It adds 3,938 input bytes and saves 119 artifact bytes.
Difference is `3938 - 119 * outputWeight`; tested prefix discounts do not change that difference.
No actual token counts, cache eligibility/hits/invalidation, model identity, hidden reasoning,
common coordination/context, native turns, quota or monetary costs were observed. These omissions
can change real price/quality conclusions. A byte saving also need not be a token saving.

## What the logs support

- Diagnostic retrieval selected `check-errors-read` and `read-truncated-range`. The first is an
  applicable skeleton but needs stricter paths/refusal records, ±2 rather than ±3 lines, and smaller
  output caps. The second is unnecessary to the public contract.
- Located-line retrieval selected `find-files-empty-widen` and `read-truncated-range`, not
  `read-not-found-locate`. The selected search-first/widening and truncation-reread behaviors do
  not fit this contract's bounded read-first/ENOENT-only/no-reread rules.
- On artifacts correctly obeyed the task instead of copying incompatible behavior. Off artifacts
  met the same requirements. Similar syntax cannot establish that examples causally helped.
- The current index does have positive-score BM25 and tool-compatibility gates. Its missing gate is
  behavioral applicability; do not describe it as injecting zero-match snippets.

Independent read-only review verified hashes, counts, arithmetic, frozen source bytes and these
contract comparisons. No in-contract artifact defect was found. Only one artifact per cell and two
small tasks were observed; no statistical significance, model equality or generalization is claimed.

## Decision and next refinement

**Park the current two-snippet presentation policy as an inactive reference; do not promote it.**
This bounded pilot found no quality gain and higher visible-payload burden. Retain its branch,
source and evidence; do not conclude that the entire hotpath family is globally ineffective.
A single-snippet cap is the smallest same-family ablation, but it will not fix the wrong top located
match. Applicability/abstention is a separate possible refinement requiring generic criteria and
independent coverage. Do not hand-pick the desired seed or rewrite these tasks to favor a candidate.

Classifier filtering remains effectiveness-unmeasured without actual classifier runs. Selector
reuse remains unwired/opportunity-unmeasured. Exact declaration-type interning is a separate
static-context candidate under local validation; this pilot is not evidence for that candidate.
No full-project winner or full-fixed60 success is declared. Plans remain draft; no default merge.

## Reproducibility record

Ignored raw run directory: `experiments/runs/native-comparison/pilot-20261102-v2/`.
Raw artifacts/reports stay there and are not relocated into tracked files. This is a curated progress
record, not a raw-run export. The manifest records source hashes, exact briefs, selected IDs, case
hashes, limits and observed checkout identity. Native provenance is coordinator-declared/unverified.

- Manifest SHA256: `a073bb1b58d39f70084d3033e5705c4a6e450c03e6b1a386a251adb974033e2c`
- Summary SHA256: `698114352c42667aa4d032191f2c8bb8d50dccbdbc107ff0cdcece229c78abca`
- Diagnostic off source: `8d33f308833c622b8a45dca0f8852de057d178908f0f48945b97f6b27da8dbb0`
- Diagnostic on source: `216aa95dbb9662ca285abc86eb28a7ef61654fadb887be5b60b490cad0fd754d`
- Located on source: `32e6b71dd3f6d553aeea42d5e0e1d9ac8db29688453d327559a90991d6673908`
- Located off source: `23008226a77e497a58b450ca054275dd1fcb43ddc8af42e5c29e21cfb3ead07b`

Commands are documented in `docs/native-comparison.md`; all four actual grade calls used
`coordinator-declared-dot-assisted`, then one complete summary. The four assignments were launched
manually, never through a provider adapter, CLI transport or automatic completion queue.
