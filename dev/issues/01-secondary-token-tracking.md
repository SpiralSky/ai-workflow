# Issue 01 — Secondary LLM Token Tracking Missing

**Status:** Clear fix needed  
**Priority:** High (blocks evaluation of whether orchestrate is actually cheaper)

## Problem

Every `orchestrateTurns` field in `.meta.json` is `0` and `subCost` is `0`.
The secondary LLM (inside `orchestrator.ts`) makes its own `complete()` calls per turn, but those token counts and costs never propagate back into the parent job's meta.

Without this, it is impossible to:
- Verify the core cost claim (orchestrate mode is cheaper per task than baseline)
- Know how many secondary turns a job actually used
- Identify which tasks blow up secondary costs

## Root Cause

`orchestrator.ts` runs the secondary loop internally via `complete()` calls, but the
`Session` object used for the child (`makeChildSession`) does not accumulate token
counters, or those counters are never read back by the runner when it writes the meta.

## Fix Plan

1. Audit `makeChildSession` — does the child session share or copy the parent's
   token accumulator?
2. After `orchestrate()` returns, read the child session's accumulated input/output
   token counts and secondary-LLM turn count.
3. Write those into the job meta as `secondaryInputTok`, `secondaryOutputTok`,
   `orchestrateTurns` (actual), and `subCost` (if cost is calculable from model
   rates × tokens).
4. Update `build-data.mjs` (viewer) to display secondary token breakdown
   alongside main-LLM tokens.
5. Add a `totalTok = inputTok + secondaryInputTok` rollup for easy comparison
   across modes.

## Verification

After fix: run a 3-job orchestrate eval and confirm `orchestrateTurns > 0` and
`secondaryInputTok > 0` in all `.meta.json` outputs.
