# Issue 07 — Orchestrate Pass Rate Below Baseline (63% vs. 74%)

**Status:** NEEDS DISCUSSION — root cause analysis incomplete; discuss before acting

## Problem

On the 2026-10-18 eval (DeepSeek v3, 27 jobs each):
- baseline: 74% pass (20/27)
- orchestrate: 63% pass (17/27)

Orchestrate mode should eventually equal or beat baseline if the architecture is
sound. The current gap means the two-tier design is losing something that the
direct tool-use baseline gets "for free".

## Likely Contributing Factors

1. **Stateless secondary** (Issue 06) — the secondary rediscovers context each call,
   losing facts baseline carried implicitly across turns.

2. **Weak model on a harder interface** — DeepSeek v3 writes TypeScript branch
   programs less reliably than it calls native tools. On a stronger model
   (Claude Sonnet 5.5+) the gap might close or invert.

3. **BM25 shortlist misses** (Issue 03) — wrong tools in shortlist → secondary
   can't complete the task even with perfect reasoning.

4. **Task decomposition not guided** — the main LLM decides when to call delegate
   and with what task description. If it under-specifies (no file names, no
   function names), the secondary burns turns on discovery.

5. **No cross-call learning** — baseline accumulates evidence across turns;
   orchestrate resets. Multi-step problems that need "understand then fix" naturally
   suit baseline's continuous context.

## Open Questions for Discussion

> **AI: bring this up with the user before making changes.**
> Ask:
>
> 1. Is the 63% pass rate on DeepSeek an acceptable starting point given that
>    it's a weak model? Should we rerun with a stronger model to get a cleaner
>    signal on the architecture before optimizing?
>
> 2. Which specific problems are failing in orchestrate but passing in baseline?
>    (Check the viewer at experiments/viewer/index.html, or the .meta.json files.)
>    Knowing the failure pattern shapes the fix.
>
> 3. Is the goal to maximize pass rate at equal cost, or to find the cost-quality
>    Pareto frontier (e.g., 70% pass at 40% of baseline cost is acceptable)?
>
> 4. Should the main LLM prompt for orchestrate mode be improved to include
>    more context in the `task` string (e.g., file paths, function names discovered
>    from the problem statement)?
>
> 5. Are there structural problem types where orchestrate will always underperform
>    baseline (e.g., problems requiring 3+ rounds of discovery-fix-verify), and
>    should those just fall back to baseline?

## Relationship to Other Issues

Fixing Issues 01, 03, 05, 06 should each independently improve pass rate.
Prioritize 01 first (get visibility), then 06 (state loss is likely the biggest
single contributor), then 03 (tool selection).

## Update (2026-10-19)

Contributing factor #4 (task decomposition not guided) and #5 (no cross-call learning) are now partially addressed via prompting changes — see [Issue 06](06-cross-call-state.md) resolution. A clean rerun is needed to measure impact.

Note: the existing 63% vs 74% scores are contaminated (per-problem hints were stripped 2026-10-19). Re-run before drawing conclusions from these numbers.

## Plan

**Design: replace `returnUser()` with plain `return` + text response**

Root cause: models forget to call `returnUser()` because it's a custom abstraction. The harness already supports text response as a loop termination path (`response.tool_calls` empty → `finalAnswer = response.content`). Moving to native `return` removes the special concept entirely.

Three files to change:

1. **`experiments/run.ts`** — system prompt (branch-only mode):  
   Change from: `"You are a skilled software engineer. Use the branch tool for all work."`  
   To: `"You are a skilled software engineer. Use the branch tool for all work. When the task is fully done, write your final answer as a plain text response."`

2. **`framework/prompt/branch-system.md`** — add at the very top (before the description):  
   `"RULE: Every branch program MUST end with return <value>. Use return to pass results between turns. When all work is complete, write your final answer as a text response (not a branch call)."`  
   — remove `returnUser()` from required-pattern framing in examples (keep the helper listed but not as required)

3. **`framework/src/server.ts`** — change the plain-return tool result message:  
   From: `"Returned — no changes delivered yet. Call branch again to apply changes, or returnUser once done."`  
   To: `"Returned — no changes delivered yet. Call branch again to apply changes, or write your final answer when done."`

`returnUser()` stays in the API for backwards compat but is no longer required or emphasized.

**Expected outcome:** Writing text at the end becomes correct behavior (not a failure). The `(no return value)` failures disappear because the only way to fail is to have a branch program with no `return` statement — a TS syntax error, easily caught.

**Verification:** Run fresh eval (branch-only, n=3, deepseek/deepseek-chat-v3-0324) and check pass rate ≥ baseline.
