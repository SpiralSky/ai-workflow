# Issue 09 — Residual Problem-Specific Hints in orchestrate-system.md

**Status:** DONE (2026-10-19) — problem-specific examples replaced with neutral code in both orchestrate-system.md and system-always.md

## Problem

The 2026-10-19 session stripped per-problem hints from `orchestrate-system.md`
to fix fairness (no mode should have advantage from problem-specific knowledge).
The cleanup was incomplete: four problems still have direct hints embedded in the
examples section (`framework/prompt/orchestrate-system.md:110-115`):

- **p03 (discount-mismatch):** exact error value `AssertionError: 99.85 != 85`
  with fix hint
- **p01 (chunk-off-by-one):** "range-based loop dropping trailing partial chunk"
  + list comprehension fix
- **p05 (report-refactor):** "sales/costs formatters still copy-pasted"
- **p04 (vague-rate-limit):** `messenger.py` / `sent = []` / "your new
  rate-limiting variables here" — this one was *explicitly targeted* for removal
  in the 2026-10-19 session but remains

### Asymmetry with baseline

`baseline`'s `system-always.md` uses `chunks.py` / `range(0, len(xs) - n, n)`
(p01 exact fix) and `report.py` / `OLD_SALES_AND_COSTS` (p05) as code examples.
So both modes leak p01/p05. Orchestrate additionally leaks p03 and p04 that
baseline does not have — a meaningful asymmetry.

## Impact

Any comparison between orchestrate and baseline on p03/p04 is invalid until
this is fixed. Cleaned evals on these problems will likely show lower orchestrate
pass rate than current numbers suggest.

## Open Questions

> **AI: bring this up with the user before making changes.**
>
> 1. Should all problem-specific content be removed from both `orchestrate-system.md`
>    and `baseline`'s `system-always.md` to make the comparison fully clean?
>    Or is having the same hints in both modes acceptable (equal contamination)?
>
> 2. Are the examples in these prompts strictly for teaching the output format,
>    or are they expected to contain realistic-looking code? If format-only,
>    replacing them with neutral placeholder code (e.g., a trivial math function)
>    would eliminate the problem entirely.

## Fix Plan (once direction is agreed)

Remove or replace the four problem-specific examples in `orchestrate-system.md`
with neutral code that doesn't hint at any eval problem. Mirror the same change
in `system-always.md` if full neutrality is the goal.

Re-run eval on p01/p03/p04/p05 after the fix.
