# Branch framework

A TypeScript MCP stdio server exposing one tool, `branch({intent, code})`. The model writes a short async TS program that runs in a
`node:vm` sandbox with helpers (`bash`, `readFile`, `edit`, `runTests`, `check`, `classify`, `llm`, `returnUser`, ...; see
`prompt/helpers.d.ts`). Only the return value and a path summary come back, which saves round-trips and context. A PostToolUse hook
delivers the `returnUser` message to the user once and ends the turn; Stop/UserPromptSubmit hooks show a change report every turn. `node:vm` is not a security boundary.

## Quick start
```
./setup.sh                    # checks node>=22 + claude, npm ci, generates mcp.json/settings.json, builds prompt, tests, tsc
cd /some/scratch/dir && /path/to/framework/bin/claude-branch     # isolated run: only this framework's config, no user settings/MCP
```
`claude-branch` passes extra args through to `claude` (e.g. `-p "fix the bug"`).

## Install into an existing project (project scope only)
```
bin/install-project <dir> --dry-run [--report intent|none]   # preview
bin/install-project <dir> [--report ...]                               # merge .mcp.json, .claude/settings.json, CLAUDE.md import
bin/install-project <dir> --uninstall
```
Nothing is overwritten (existing entries are merged), and `~/.claude` / `~/.claude.json` are never touched. Claude Code will ask to
approve the project MCP server and the external `@import` on first use.

## Env vars
- `BRANCH_REPORT` = `intent` (default) | `none`. Controls only the prompt rule (build-prompt: final message must say what/why per file; rebuild
  with `BRANCH_REPORT=none bin/build-prompt` to omit). The auto change report is always on: a `UserPromptSubmit` hook (`bin/report-hook.mjs`)
  snapshots the workspace, the `Stop` hook shows `Changes: file (+a −d) · tests: ok` as a `systemMessage` (user only, 0 model tokens; silent if
  nothing changed). On `returnUser` (`continue:false` skips Stop) `return-user-hook.mjs` appends the same block to the message instead; once per turn.
  `tests:` comes from the last `runTests` (server writes it to `<trace dir>/state/`). Also traced as `{type:"report", text}`.
- `BRANCH_TRACE_DIR` (JSONL traces; default tmp), `BRANCH_CWD` (workspace; default process cwd),
  `BRANCH_CLASSIFY_MODEL` / `BRANCH_WEAK_MODEL` / `BRANCH_STRONG_MODEL`, `ANTHROPIC_API_KEY` (else sub-calls use the `claude` CLI), `CLAUDE_BIN`.

## Layout
`src/` server, runner, helpers, llm, report-core.mjs (shared with hooks), trace · `prompt/` system prompt parts (`.system.full.md` is generated) ·
`bin/` claude-branch, build-prompt, gen-config, install-project, return-user-hook.mjs, report-hook.mjs · `*.template.json` (with `__FW__`) →
generated `mcp.json`/`settings.json` · `test/` · `../eval/run.ts` benchmark (`npm run eval -- --help`).
