Context: /home/spiralsky/projects/workflow-experiments. Read docs/PLAN.md (design), HANDOFF.md (state), framework/src/*.ts, framework/prompt/*.
`framework` is a TS MCP stdio server exposing one tool `branch({code})` that runs a model-written TS program in node:vm with helpers
(see framework/prompt/helpers.d.ts). Run with `npx tsx` from framework/. Typecheck: `cd framework && npx tsc -p .` (must stay clean).
Rules: keep command outputs filtered (| tail -n 30). Do not modify ~/.claude or user-scope config. Do not run `claude` interactively.
No LLM calls in tests (check/classify/llm need a model; skip them). Finish with a report of at most 10 lines: files written, test results, open issues.
