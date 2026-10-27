# orchestrate: reduce redundant re-reads in write dispatches

**Date:** 2026-10-27  
**Step:** post-step-7 analysis (token cost comparison + do-call classification)  
**Status:** pending

---

## What happened

Full-compare analysis (run `2026-10-27T05-20-16Z-9216`) showed orchestrate costs 6× baseline.
Classifying the 92 `do` calls across 21 jobs: 55% read-only, 24% write, 21% test-only.
The dominant waste: every write `do` call re-reads the file the planner already read in the
preceding read `do` call. Example from `04-vague-rate-limit.orchestrate.1`:
- do #1: executor reads `messenger.py`, returns full-text report to planner
- do #2: executor reads `messenger.py` **again** before editing it
The executor restarts fresh each `do` call, so it has no memory of do #1's read.

Also: do #1 takes 2 secondary turns — sec-turn 1 calls `readFile`, sec-turn 2 is output-only
(executor assembles the report text). With the reference system this second turn can be avoided.

The planner prompt currently says *"Break the task into steps: find the cause, apply the fix,
run the tests."* — this encourages separate read and write dispatches. The reference system
(`@s2.c1`, `@path#Symbol`) exists but the planner doesn't use it when writing write instructions.

## Decision needed

1. Should the planner prompt require passing a file reference in write instructions when the file
   was already read in a prior do call?
2. Should the planner prompt allow combining read+fix+test in a single do call for simple,
   well-understood fixes (rather than always splitting into separate do calls)?

## Options considered

1. **Enforce reference passing** — add a rule: "When dispatching a write after reading a file,
   pass `@path` in the instruction so the executor can dereference without re-reading."
   - Pro: eliminates ~1 sec-turn per write do call; no architectural change needed
   - Con: relies on executor correctly handling `@ref` dereference; adds complexity to planner prompt

2. **Allow read+fix+test in one do call** — revise the "do not hand over the whole task" rule to
   "for simple, well-understood fixes, combine read+fix+test in a single do call."
   - Pro: reduces do calls from ~4–5 to ~2, halving secondary turns on simple problems
   - Con: executor gets a harder task per do; planner loses per-step visibility; harder to diagnose failures

3. **Both** — reference passing for writes that follow a read; combined dispatch allowed for
   simple cases. Prompts would distinguish "exploration" (split ok) from "apply known fix" (combine).

## Recommendation

Option 3, starting with reference passing (lower risk). The combined-dispatch rule is the bigger
gain but requires care in the prompt to avoid over-delegating on genuinely complex multi-step fixes.

## Files affected

- `docs/specifications/features/orchestrate.md` — planner prompt rules (§ on `do` dispatch)
- `packages/core/prompts/orchestrate.md` — planner prompt implementation

## To unblock

Approve option 1, 2, or 3, or give guidance on which part to start with.
