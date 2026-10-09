# Loop Framework Testbed

Five small problems for designing and refining a loop-based AI development framework.
For each one, write down in `STEPS.md` what you *intend* the AI to do at every iteration.
Then run your framework on it and compare.

| # | Problem | What it tests |
|---|---------|---------------|
| 01 | chunk-off-by-one | Basic loop: reproduce → fix → verify → stop |
| 02 | inventory-feature | Implementing new behavior + writing its own tests |
| 03 | discount-mismatch | Bug spanning 2 files; *which* side to fix is a judgement call |
| 04 | vague-rate-limit | Underspecified request: should the loop ask before acting? |
| 05 | report-refactor | Refactor with a "no behavior change" guard; knowing when to stop |

Each folder has:
- `PROBLEM.md` — the task exactly as you'd give it to the AI (the prompt), plus hidden notes for you
- code + `test_*.py` — run with `python3 -m unittest` inside the folder
- `STEPS.md` — blank template for your intended loop trace

Reset a problem after a manual run: `git checkout -- loop-testbed/problems/<id>` (the eval harness works on temp copies and never modifies these).
