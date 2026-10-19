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
| 06 | import-cycle | Circular import; requires structural reasoning to break correctly |
| 07 | async-race | Race condition in async code; must reason about execution order |
| 08 | api-mismatch | Consumer/provider contract mismatch; which side owns the fix? |
| 09 | cache-invalidation | Stale cache bug; requires understanding invalidation semantics |

Each folder has:
- `PROBLEM.md` — the task exactly as you'd give it to the AI (the prompt), plus hidden notes for you
- code + `test_*.py` — run with `python3 -m unittest` inside the folder
- `hidden/test_hidden.py` — acceptance test the AI never sees; `experiments/run.ts` copies it in after the run (must FAIL on the unmodified code — check with `npm run eval -- --selfcheck` from framework/)
- `STEPS.md` — blank template for your intended loop trace

Reset a problem after a manual run: `git checkout -- experiments/problems/<id>` (the eval harness works on temp copies and never modifies these).

## Running experiments

From `framework/`:
```bash
npm run eval -- --problem all --mode compare --n 3 --model sonnet
```

Modes: **baseline** (control, direct tools), **branch-only** (branch MCP only), **orchestrate** (delegate → BM25 → sub-LLM).
**compare** = branch-only + orchestrate (default). **both** = baseline + branch-only. **all** = all three.

Use `--backend openai` to swap the main model to an OpenAI-compatible endpoint while keeping all modes intact:
```bash
OPENAI_BASE_URL=https://openrouter.ai/api/v1 OPENAI_API_KEY=<key> \
  npm run eval -- --problem all --mode compare --n 3 --backend openai --model qwen/qwen-2.5-72b-instruct
```

Results viewer: `npm run view`, then open `experiments/viewer/index.html`.
