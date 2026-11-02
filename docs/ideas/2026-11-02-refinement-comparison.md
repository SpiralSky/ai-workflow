# Evidence-led orchestration refinements (draft, 2026-11-02)

Base: `67b42ae04153079e84b1fdacdd0082a2e623ffc8` (current classifier PR #4 head).
No live campaign, measured monetary saving, calibrated classifier quality or
full-task model success is established. This is experimental development, not
plan approval or a change to the fixed full-success requirement.

## What is already present

- BM25 indexes are cached by catalog-array identity.
- Orchestrate `findTools` can expand selection while excluding already-present
  tools and upgrades write-capability locks before exposing them.
- `branch-only[toolSearch]` exposes tools lazily and retains discoveries.
- Reference passing, code references and `replaceSymbol` already exist.
- Hot paths are adopted in specifications, and executor injection exists, but
  `buildFramework` still refuses the hotPaths variant. Adoption is not end-to-end
  implementation. The ideas index's older 'Raw' label was inaccurate.

Do not count these existing mechanisms as new optimizations. The older ~6x cost
observation used different tasks and defective accounting; it is not a current
baseline for a savings claim.

## Primary references and implications

1. [ToolRet, ACL 2025](https://aclanthology.org/2025.findings-acl.1258/) reports that
   general retriever quality does not automatically transfer to tool retrieval
   and downstream task success. Implication: distinguish retrieval omission,
   classifier rejection, top-N truncation, dependency completion and recovery.
   A short prompt or synthetic selector agreement is not a task-quality result.
2. [Anthropic advanced tool use](https://www.anthropic.com/research/advanced-tool-use)
   describes deferred discovery with selected tools retained up front. Its vendor
   measurements are not evidence for our models/catalogs. Much of the mechanism
   already exists here; a new experiment must identify an actual missing part.
3. [Code execution with MCP](https://www.anthropic.com/research/code-execution-with-mcp)
   motivates limiting intermediate context and discovering tools on demand. Its
   examples do not establish a matched end-to-end saving for this codebase.
4. [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
   describes prefix-sensitive reuse. Stable context order and actual cached-token
   observations matter: fewer raw tokens do not automatically mean lower billed
   cost. Support/pricing must be verified for the provider/model actually used.
5. [OpenAI latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization)
   motivates avoiding redundant requests and using deterministic computation
   where suitable. Our exact-selection reuse experiment tests that mechanism,
   not OpenAI cache hits or cross-provider savings.

## Separate refinement branches

| Work | Branch | Question | Evidence required before promotion |
|---|---|---|---|
| Frozen comparison contract | `dot/design-contract-hardening-20261102` | Can malformed or optimized-Python input evade the design checks? | Adversarial normal/-O tests, unchanged full60 design, all readiness flags false |
| Exact selection reuse | `dot/selector-reuse-20261102` | Can accounted identical selection decisions be reused inside one explicit task/revision without stale selection or duplicate billing? | Offline invalidation/cancellation/accounting contracts first; then separately authorized matched full-success evaluation |
| Test scheduling isolation | `dot/test-resource-isolation-20261102` | Can declared serial file scheduling avoid local resource contention without altering assertions or coverage? | Full unchanged test inventory, native probes, zero skips and typecheck under a recorded common harness |

The first and third are measurement/verification foundations, not claimed cost
optimizations. The second is an opt-in library prototype; it is not automatically
wired into runner/engine state revisions. Generic LLM/custom selectors remain
uncached unless a future reviewed accounting contract makes reuse safe.

## Fair comparison constraints

- Keep all 10 tasks ×3 frameworks ×2 catalog tiers (60 configured cells per
  repetition). These are not 60 statistically independent tasks.
- Preserve required functionality, grader checks, all attempts/failures and cost
  attribution. Full success and quality precede cost ranking.
- Keep source, fixtures, model/routes/settings, tool permissions, limits and run
  ordering fixed within matched comparisons. Change one mechanism per ablation.
- Separate initial required-tool coverage from eventual coverage after recovery;
  accept valid alternative tool routes rather than treating one trace as truth.
- Freeze thresholds/hot-path membership on separate development evidence, never
  tune them on the target outcomes. Existing threshold remains null/unselected.
- Treat cache-layout and selector-call reuse as separate interventions. Log actual
  input/cached/output/reasoning tokens where available; retain unknown amounts.
- Count every selector call, fallback, expanded definition, retry and failure.
  A hit must not emit another billed model turn or silently turn unknown cost zero.
- Stop expansion on infrastructure/configuration/accounting failure and fix it.
  Genuine task failure remains an outcome; truncated campaigns are incomplete,
  not successes based on their surviving subset.
- Offline deterministic call counts and fixture equivalence are proxies only.
  They cannot establish monetary savings, model quality, task completion or
  generalization. No provider warm-up or paid experiment is authorized here.

## Next genuine product hypothesis

A generic, bounded hot-path seed set is actual unfinished specified work, unlike
another lazy-discovery wrapper. Any implementation must follow orchestrate §9
and engine §4.5, compile each snippet, test mocked failure/recovery behavior,
include declared tool dependencies, stay off by default, and be evaluated as a
separate within-orchestrate ablation. No benchmark-specific hints or broad host
filesystem searches should be copied from the old illustrative idea snippets.
