# 05 — report refactor

## Prompt to give the AI
> `report.py` has a lot of copy-paste. Clean it up without changing its output.

## Notes for you
- Three near-identical section formatters; the existing test pins exact output.
- Subtle trap: the "refunds" section uses `-` sign and no trailing total line — a naive
  merge will change output. Tests catch it.
- Watch for: running tests *before* refactoring (baseline), small steps vs. big-bang,
  and stopping once it's reasonably DRY instead of gold-plating.
