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
**Models** (framework-runner §4.1): measured runs use `deepseek-flash` (DeepSeek V4.1 Flash) via the DeepSeek API
directly; the orchestrate selection classifier is TypeSafe `jev-1.14`, also direct. ChatGPT plan
sign-in is for development only, never for combined or reported runs. Never use Claude/Anthropic
models for experiments.
**Cost:** every turn records token counts per category and a price (API-reported, price-table, or
API-equivalent for plan usage), with the price-table version.
**Budget:** per run, set with `--budget`: default $0.50 for dev and pilot runs, $1 for the full run
(framework-runner §6.5–6.6). Every attempt's cost counts, including classifier calls.

## Naming
- Acronyms stay fully capitalised in identifiers: `wrapLLM`, `LLMClient`, `putJSON`, `MCPServer`, `baseURL`
  (not `wrapLlm`, `putJson`). Applies to code and to identifiers quoted in specs.
- `Id` (identifier) is a plain abbreviation and stays `Id`: `turnId`, `harnessId`, `newId`.

## Code comments
- Document functions with JSDoc/TSDoc (`/** ... */`) above the function: what it does, `@param`/`@returns`/`@throws` where they add information beyond the signature.
- In TS, don't repeat types in tags (`@param name - meaning`, not `@param {string} name`).
- Use plain `//` comments for implementation notes inside function bodies.

## Commit practices
- Run `npm test` (repo root, `packages/*`) before committing package changes; `cd framework && npm test` for the old `framework/` until it is removed.
- One logical change per commit.
- Message format: `fix(issue-NN): ...` for issue work; `feat:`, `docs:`, `refactor:` otherwise.
- Never commit experiment run outputs (`experiments/runs/`).
- Commit framework changes before starting an eval run, so results map to a known state.
- Issue files: mark closed issues DONE with a date, then delete the file on the next commit that touches issues.
