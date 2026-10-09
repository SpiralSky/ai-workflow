Task D — make framework/ a self-contained, installable folder, add change reports, evaluate report modes.

## 1. Portability + setup
framework/mcp.json and settings.json hardcode /home/spiralsky/... paths. Make the folder relocatable:
- Turn them into `mcp.template.json` / `settings.template.json` with a `__FW__` placeholder; `framework/setup.sh` (idempotent):
  checks node>=22 and `claude` on PATH, `npm ci --silent`, generates mcp.json/settings.json with the absolute framework path,
  runs build-prompt, `npm test`, `npx tsc -p .`. bin/claude-branch and eval/run.ts keep working (they may call setup if files missing).
- `framework/bin/install-project <dir> [--dry-run]`: adds the framework to an existing project at *project scope* only:
  merge (never overwrite) `<dir>/.mcp.json` (branch server), `<dir>/.claude/settings.json` (permission allow, PostToolUse hook,
  `env.ENABLE_TOOL_SEARCH="false"`, and BRANCH_REPORT if given), and add one line `@<fw>/prompt/.system.full.md` to
  `<dir>/CLAUDE.md` (CLAUDE.md import). Print what changed. `--uninstall` reverses it. Never touch ~/.claude or ~/.claude.json.
- `framework/README.md` (short: what it is, isolated test run via bin/claude-branch, install into a project, env vars, layout)
  and `framework/SETUP.md`: step-by-step instructions written for a coding agent asked to "set up the branch framework"
  (run setup.sh, verify, optionally install-project, how to verify the tool is loaded: `claude -p ... --output-format stream-json`
  init event lists mcp__branch__branch). Keep both concise.

## 2. Change reports — env BRANCH_REPORT = auto (default) | intent | summarize
"auto" is always on; the other two add to it.
- auto (no tokens): when a branch calls returnUser, the server appends a compact block of what actually changed this turn:
  per file `path (+a −d)` and the last runTests result, e.g. `Changes: chunk.py (+1 −1) · tests: ok`. Detect changes by
  snapshotting workspace files (skip node_modules/.git/__pycache__/.branch-traces, files >200KB) at server start and after each
  returnUser, and diffing on the next returnUser — this also catches bash and built-in Edit tool changes. Line counts via a simple
  LCS/diff on lines (no new deps if avoidable). No changes → `No file changes.`
- intent: build-prompt adds (only in this mode) a rule: the returnUser message must say, per changed file, what changed and why
  (≤3 lines). build-prompt takes the mode from BRANCH_REPORT.
- summarize: on returnUser, the server calls the weak/classify model (src/llm.ts backend) with ONLY: user-visible returnUser text,
  each branch's intent + path summary for this turn, and the auto diff (capped 3000 chars). Output ≤4 lines, prepended to the
  auto block. Record its tokens/cost in the trace (type "report"). On failure fall back to auto only.
- Tests for snapshot/diff and the auto block (no LLM). Hook must keep delivering the combined message once.

## 3. Eval
eval/run.ts: add `--report auto|intent|summarize` (sets BRANCH_REPORT, passes to build-prompt), a `subCost` column (sum of
sub-LLM cost from trace files of that run, incl. report calls; check how llm.ts records cost), a `msgChars` column (length of the
final user-visible message), and save that message to `<runsDir>/<tag>.final.txt`. Allow `--problem all`.
Then run: `--problem all --mode branch-only --n 1 --model sonnet` once per report mode (3 runs of 5 problems). Write
dev/out/jobD.report.md: one table (problem × mode: pass, turns, cost, subCost, out tokens, msgChars) + the 15 final messages
verbatim (they are short) + 3 lines on which mode gives the best accuracy/cost. Final report to stdout ≤10 lines.
