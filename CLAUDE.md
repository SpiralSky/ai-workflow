# AI Workflow — Project Instructions

## Specifications are the source of truth

- `docs/specifications/features/` — feature specs, one per feature (index: its `README.md`)
- `docs/specifications/architecture/` — architecture specs derived from features
- `docs/ideas/` — rough exploratory notes; not scheduled or specced

Before working on a feature (framework modes, runner, tools, problems, viewer, harness integration),
read the relevant spec section. If this file, `HANDOFF.md`, memory, code comments or the code
disagree with a spec, follow the spec and flag the conflict to the user. Notes below are a cache of
things easy to get wrong; the spec wins.

## Quick notes (cache)

- `--mode` names: `baseline`, `branch-only`, `orchestrate`; `compare` = all three.
- Visualize experiment results only with the project viewer (`docs/specifications/features/viewer.md`), never with Claude artifacts.
- No backward compatibility with old run formats; delete stale runs rather than adapting to them.

## Running experiments
```bash
# From framework/ (OPENAI_BASE_URL + OPENAI_API_KEY required):
OPENAI_BASE_URL=https://openrouter.ai/api/v1 OPENAI_API_KEY=<key> \
  npm run eval -- --problem all --mode compare --n 3 --model deepseek/deepseek-v4-flash

# Retry only failed jobs from a prior run:
OPENAI_BASE_URL=https://openrouter.ai/api/v1 OPENAI_API_KEY=<key> \
  npm run eval -- --retry-failed <run-dir-timestamp> --mode orchestrate --n 3 --model deepseek/deepseek-v4-flash
```

**Models:** never use Claude/Anthropic models via OpenRouter. Use `deepseek/deepseek-v4-flash` only.
**Budget:** $0.50 total per key; max $0.10 per run if costs are tight.

## Code comments
- Document functions with JSDoc/TSDoc (`/** ... */`) above the function: what it does, `@param`/`@returns`/`@throws` where they add information beyond the signature.
- In TS, don't repeat types in tags (`@param name - meaning`, not `@param {string} name`).
- Use plain `//` comments for implementation notes inside function bodies.

## Commit practices
- Run `cd framework && npm test` before committing framework changes.
- One logical change per commit.
- Message format: `fix(issue-NN): ...` for issue work; `feat:`, `docs:`, `refactor:` otherwise.
- Never commit experiment run outputs (`experiments/runs/`).
- Commit framework changes before starting an eval run, so results map to a known state.
- Issue files: mark closed issues DONE with a date, then delete the file on the next commit that touches issues.
