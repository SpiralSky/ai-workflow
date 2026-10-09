# 01 — chunk off-by-one

## Prompt to give the AI
> `chunk()` in `chunks.py` sometimes loses items. Fix it.

## Notes for you (don't give to the AI)
- Bug: the trailing partial chunk is dropped (`range` stops too early).
- Ideal loop is ~2 iterations: run tests → see failure → one-line fix → tests pass → stop.
- Watch for: over-engineering, rewriting the function, not running tests before/after.
