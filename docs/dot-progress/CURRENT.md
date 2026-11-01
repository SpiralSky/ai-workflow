# Current development status — 2026-11-01 06:10 UTC

No plans or PRs approved, merges, force-pushes, live model calls, OAuth grants, or paid inference performed. Default branches remain unchanged. Experimental development is authorized; final merge is the owner's decision. Plans remain draft.

## Published review stack

1. Migration PR #1: https://github.com/SpiralSky/ai-workflow/pull/1
   - Branch `dot/specplane-migration-review-20261101`, remote `be2500de70b9b29b0a97ee03a4561b47df4f5a30`.
   - Exact hygiene snapshot `051538091f97c63d0435fe0ab51b3142d04283d0`, tree `949995e5d1535a5b37eca9012bec36d51cd35da4`.
   - 384 package +13 workflow checks passed. Original 19 spec bodies and six history records retained.
2. ChatGPT sign-in and credential isolation PR #2: https://github.com/SpiralSky/ai-workflow/pull/2
   - Branch `dot/openai-signin-review-20261101`, remote `f3bc9a2b6eacc56248849507d23b0653dae2ef99`.
   - Exact local `42ff9e5773614dec4c314daf68a19e59bac8e488`, tree `9245b691d1ef5bd6503082818db0bf9819cc6056`.
   - 533 package +22 script checks passed. Official OAuth/Responses implementation; all runner orchestration providers use host-only credentials and network-disabled task containers.
3. Direct DeepSeek PR #3: https://github.com/SpiralSky/ai-workflow/pull/3
   - Branch `dot/direct-deepseek-review-20261101`, remote `c1506aa2931254fbe7e673369549f2d9a040b534`.
   - Exact local `9ed722f2b333a881ae9f3486765dc66ff6042631`, tree `5d7fd8156a91ec08d6027d5ea57a3945c132fbd5`.
   - 547 package +22 script checks passed. Cache-aware dated estimates, explicit limits and off-peak check before each request. Actual dollars remain unknown.
4. Typed classifier filtering PR #4: https://github.com/SpiralSky/ai-workflow/pull/4
   - Branch `dot/classifier-review-20261101`, remote `91afef3086a3d6ec9e3843d9f73893c68cdf54a5`.
   - Exact local `b810601fc2d14fc54af70f3834ae13f169ae7a0f`, tree `357279bfc6d7899c3ec19770c760adf322593e55`.
   - 591 package +22 script checks passed, 42 focused composition +6 offline design checks, independent 44 focused source checks. Typecheck, snapshot preservation, artifact freshness and ignore checks pass.
   - Explicit typed filtering option; existing default unchanged. Jev/Microsoft/Perplexity and other verified models via OpenRouter; direct TypeSafe Jev with direct DeepSeek needs no OpenRouter. Separate campaign estimate gates, actual money unknown, no hidden paid fallback. Original specs restored exactly; experimental extension separate and unapproved.

All PRs are drafts and stacked in the order above. No approvals or merges.

## Specplane

- Published development `dot/complete-framework-20261031`: remote `d5b9afcd40c5172420c6da1eae6562784e7d7f78`, local `3164e1474165df092a45d8b275f295525718f6d8`; 317 CLI +73 hook tests passed.
- Published stacked integration `dot/codex-integration-20261101`: remote `73cd690cd474245a87121912298ccd8e15063513`, local `0480df6aa72481e4ba7e534de394ad17eea9acac`; 324 CLI +73 hook tests passed.
- Codex support is CLI/manual, not a background adapter. Live Claude unverified. Original plan statuses untouched; amended specs draft/review and ADR proposed.

## Actual Docker evidence

- Full fixture self-check success: https://github.com/SpiralSky/ai-workflow/actions/runs/41267929116, exact source tree `4fb02bff34675cb62b00aa9e6d1dea9b2bf70842`. Initial missing ripgrep and uppercase image-tag issues fixed before expansion. This is fixture readiness, not model task success.
- Native readiness predecessor success: https://github.com/SpiralSky/ai-workflow/actions/runs/41275006919.
- Exact DeepSeek source native success: https://github.com/SpiralSky/ai-workflow/actions/runs/41275807779. Relocated isolated-vm/tier-L test passed with zero skips, actual Node22.15.0 ABI127 Linux x64, source/hygiene/freshness checked before build.
- Final classifier native CI passed: https://github.com/SpiralSky/ai-workflow/actions/runs/41279632208 on `dot/classifier-native-ci-20261101`, head `6df5c21946b293583c38393026bc2fe135ca271d`, exact classifier source plus pinned workflow only. Source verification/hygiene/freshness passed, relocated native/tier-L probe passed with zero skips, target Node22.15.0 ABI127.
- Transport-only CI branches must not merge. Incomplete `dot/docker-bundle-ci-20261101` has no workflow. No branches deleted. API-created commit SHAs differ from local commits; exact source trees verified.

## Evaluation methodology and remaining gates

- Preserve all 10 reported tasks ×3 frameworks ×2 tool-catalog tiers =60 jobs/repetition. No live baseline, full model success or measured cost reduction exists.
- Fair offline protocol is in PR #4: LLM/none/Jev/Microsoft/Perplexity Flash candidate arms; 300 potential cells are not an execution order or first spending plan. Main provider/model remains fixed per matched block; direct estimated and reported-dollar blocks are separate.
- Start with mocks, then separately authorized one smoke/tiny predeclared pilot. Serial fail-fast, no automatic paid retries; stop expansion and fix first terminal error. Ordinary recoverable task-tool debugging remains permitted. Full success on every required task before cost ranking; no test-set threshold tuning or omitting failures.
- Thresholds remain uncalibrated. Candidate recommendations are capability/list-price based, not proven quality or savings. Price/alias snapshots may change. Final-response overshoot and cancellation-not-refund limits explicit.
- Actual OAuth consent/API credentials and bounded live spending authorization still needed before live evaluation. Do not infer these from code-upload approval. ChatGPT subscription plus paid classifier currently rejected rather than mixing budgets silently.
- Legacy standalone server credential flags remain outside the safe runner path; do not pass provider secrets to untrusted containers.
- Codebase Memory0.12.1 installed on Dot's own workspace; CLI version/help verified, graph/index/query blocked by Unix IPC permission restrictions. No valid branch indexes or successful symbol queries. Native MCP unavailable; installing elsewhere would not meet own-computer requirement.

## Autonomous decisions

Keep provider credentials host-only; use fixed official endpoints and strict admission/cancellation gates. Preserve optional existing behavior until full success is measured. Treat actual costs and tariff estimates separately, retain unknown totals and known subtotals, and stop after unknown accounting rather than allowing further spend. Keep original specification hashes immutable and put new experimental requirements in separately labeled extensions. None of these technical decisions constitutes user plan/PR approval.
