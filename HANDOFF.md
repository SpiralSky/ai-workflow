# Handoff

**Goal:** branching loop framework (see `docs/PLAN.md`), tested as an MCP tool inside a *separate* Claude Code instance, evaluated on `loop-testbed/`.

**Built (Phase 0 + most of Phase 1/2):**
- `framework/` — MCP stdio server exposing `branch({code})` (`src/server.ts`), node:vm runner (`src/runner.ts`), helpers
  (`src/helpers.ts`), sub-LLM via `claude -p` CLI or API key (`src/llm.ts`), JSONL traces (`src/trace.ts`).
  `prompt/` = tool description, helpers.d.ts, system.md. `npm test` (20 pass, no LLM), `npx tsc -p .` clean.
- Separation from normal Claude Code: `--setting-sources "" --settings framework/settings.json --strict-mcp-config
  --mcp-config framework/mcp.json --append-system-prompt-file framework/prompt/system.md` (verified: hooks in `--settings` fire,
  no separate login needed). Wrapper: `framework/bin/claude-branch` (interactive use).
- returnUser: server marks result `<<RETURN_USER>>`; PostToolUse hook `bin/return-user-hook.mjs` → `{"continue":false}`.
- Eval: `cd framework && npm run eval -- --problem 01 --mode baseline|branch|branch-only|both|all --n 3 --model sonnet`.
  Raw streams + branch traces in `eval/runs/<ts>/`. branch-only disables built-in file/shell tools.
- Dev workflow: framework code is developed by delegating to `claude -p` (normal config) with specs in `dev/jobs/*.md` via `dev/run-job` (see README).

**Results (problem 01, n=1, sonnet, after fixes):** tool search off + `--tools Bash,Read,Edit,Write,Glob,Grep` in all modes
(context 8k; branch adds 1.7k). baseline 4 turns $0.023; branch 3 turns $0.046 (still ignores branch when built-ins exist);
branch-only 3 turns ~$0.025, 2 branches (read; edit → test → returnUser), turn ends via hook.

**Gotchas fixed:** MCP tools are deferred by default (ENABLE_TOOL_SEARCH=false); long MCP descriptions get truncated (helper API
lives in appended system prompt, built by `bin/build-prompt`); hook replaces tool output via `updatedMCPToolOutput` → "Delivered to
user." and shows the message once as stopReason (TUI prefix "PostToolUse:… hook stopped continuation:" is unavoidable).
`branch` takes `{intent, code}`.

**Setup (done):** framework/ is relocatable: `setup.sh` generates mcp.json/settings.json from templates; `bin/install-project <dir>`
(project scope, --dry-run/--uninstall); README.md, SETUP.md (agent instructions). Reports: auto change block
(`Changes: f (+a −d) · tests: ok`) now comes from hooks every turn (UserPromptSubmit snapshot → Stop `systemMessage`; returnUser hook appends it to stopReason; once per turn; `src/report-core.mjs`, `bin/report-hook.mjs`, trace event `report`). BRANCH_REPORT=intent (default)|none = prompt rule only; `summarize` removed. eval: --report intent|none, --problem all, subCost (llm() calls), msgChars, *.final.txt (message + report block).

**Report eval (5 problems, n=1, sonnet, branch-only):** all 5/5 pass. auto $0.036 avg, 0/5 returnUser; intent $0.034, 3/5 returnUser
(those runs cheapest, e.g. 05: $0.029 vs $0.040); summarize $0.038, 0/5 returnUser → summarizer never ran (untested).
Finding: without returnUser the model ends with a normal prose message (extra turn) and the auto block is never shown.

**Next:**
0. DONE (verified in -p eval: report on 5/5 turns, both paths; TUI display of Stop systemMessage still unchecked; "tests:" part missing on 02-04): hook-based report. Verify in a real run: Stop hook systemMessage is displayed, Stop does not
   also fire after returnUser, and no extra turn is triggered; `npm run eval -- --problem all --mode branch-only --n 1`.
1. Get the model to use branch when built-in tools are also available (branch mode); try one-branch read→fix when predictable.
2. Run all problems with n≥3 (`--mode all`).
3. Test check/classify/llm via CLI backend (untested with a real model).
