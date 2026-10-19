# AI Workflow — Project Instructions

## Experiment visualization
Always use the built-in viewer at `experiments/viewer/index.html`. Never use Claude artifacts for visualizing experiment results.
To build and view: `cd framework && npm run view`, then open `experiments/viewer/index.html` in a browser.
The viewer is a self-contained HTML/CSS/JS dashboard — no server required beyond `build-data.mjs`.

## Running experiments
```bash
# From the framework/ directory (OPENAI_BASE_URL + OPENAI_API_KEY required):
OPENAI_BASE_URL=https://openrouter.ai/api/v1 OPENAI_API_KEY=<key> \
  npm run eval -- --problem all --mode compare --n 3 --model deepseek/deepseek-chat-v3-0324

# New flags (2026-10-18):
#   --turns <n>       max main-loop turns per job (default 40)
#   --orch-turns <n>  max secondary-LLM turns per delegate call (default 15)
# Both default to realistic values now; only set them to override.

# Retry only failed jobs from a prior run:
OPENAI_BASE_URL=https://openrouter.ai/api/v1 OPENAI_API_KEY=<key> \
  npm run eval -- --retry-failed <run-dir-timestamp> --mode orchestrate --n 3 --model deepseek/deepseek-chat-v3-0324
```

## Model choice for experiments (OpenRouter)
**DO NOT use Claude/Anthropic models via OpenRouter** — they are expensive and burn the budget fast.
Use `deepseek/deepseek-chat-v3-0324` only — strong instruction following, good function calling, reasonable cost.

**Budget: $0.50 total per key, max $0.10 per individual run if costs are tight.**

## Experimental modes (3 only)
- **baseline**    — control: direct file tools (Bash/Read/Edit/Write/Glob/Grep), no branch tool
- **branch-only** — primary test: branch MCP tool only; model writes short TS programs
- **orchestrate** — two-tier: delegate tool → BM25 shortlist → secondary LLM branch loop
- **compare**     — shorthand for baseline + branch-only + orchestrate (all three, default)
- **both**        — shorthand for baseline + branch-only
- **all**         — all three modes

## --backend flag
- `--backend openai` (default, only option): calls OpenAI chat-completions API directly
  - Set OPENAI_BASE_URL (e.g. https://openrouter.ai/api/v1) and OPENAI_API_KEY
  - All three modes work; branch/delegate tool execution runs via the same framework modules
  - Sub-LLM calls inside orchestrate use the same OPENAI_API_KEY + OPENAI_BASE_URL as the main runner
