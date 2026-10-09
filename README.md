# workflow-experiments

Experiments with a **branching agent loop**: the model emits a short TS program (`branch({intent, code})`, an MCP tool inside
Claude Code) instead of single tool calls, to cut LLM turns and context. Design: [docs/PLAN.md](docs/PLAN.md). Current state and
next steps: [HANDOFF.md](HANDOFF.md).

## Layout
| Path | What |
|---|---|
| `framework/` | The MCP server, hooks, prompt parts, tests. Self-contained and relocatable; see [framework/README.md](framework/README.md). |
| `eval/run.ts` | Benchmark: runs `claude -p` on temp copies of the testbed problems per mode, records pass/turns/cost. Output in `eval/runs/<ts>/` (gitignored). |
| `loop-testbed/` | 5 small Python problems (`problems/0N-*`) with tests; the eval target. |
| `dev/jobs/` | Specs for framework dev tasks delegated to a headless `claude -p`; `_common.md` is prepended to each. |
| `dev/run-job` | Runs a job spec; result JSON in `dev/out/` (gitignored). |
| `docs/` | Design plan. |

## Workflow
```bash
cd framework && ./setup.sh                                       # once / after moving: deps, generated config, tests, tsc
cd framework && npm test && npx tsc -p .                         # after every change (no LLM calls)
cd framework && npm run eval -- --problem 01 --mode all --n 3 --model sonnet   # costs money; see --help
dev/run-job jobE                                                 # delegate dev/jobs/jobE.md (write the spec first)
```
1. Write a task spec in `dev/jobs/jobX.md` (goal, files allowed to change, acceptance checks).
2. `dev/run-job jobX`, review the diff (`git diff`), run tests, commit.
3. Evaluate with `npm run eval`; record findings in `HANDOFF.md`.

Generated files (`framework/mcp.json`, `framework/settings.json`, `framework/prompt/.system.full.md`) contain absolute paths and are
not committed; `setup.sh` / `bin/claude-branch` / eval regenerate them.
