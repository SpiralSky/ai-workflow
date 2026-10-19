Task G — find and fix issues, optimise and refactor the framework source.

## Working dir
/home/spiralsky/projects/ai-workflow

## Scope
Files under `framework/src/` and `framework/bin/` only.
Do NOT touch `dev/`, `experiments/`, `docs/`, `framework/test/`, or any config/lock files.

## What to do

1. **Audit** — read every file in `framework/src/` (runner.ts, helpers.ts, llm.ts, server.ts, trace.ts, report.ts, report-core.mjs) and `framework/bin/` (build-prompt, claude-branch, gen-config, install-project, install-project.mjs, log-metrics.mjs, report-hook.mjs, return-user-hook.mjs).

2. **Find issues** — look for:
   - Correctness bugs or edge-case failures
   - Resource leaks (unclosed handles, uncleared timers, orphaned workers/processes)
   - Error paths that swallow errors silently
   - Race conditions or broken concurrency patterns
   - Any TODO/FIXME/HACK comments

3. **Refactor / optimise** — look for:
   - Dead code or unused exports
   - Duplicated logic that can be unified
   - Needlessly complex code paths
   - Type unsafety or overly broad `any` casts
   - Performance: anything called in a hot path that could be cheaper

4. **Apply fixes** — make the changes directly with `edit`. Keep each change minimal and targeted; do not rewrite whole files unless unavoidable.

5. **Verify** — after all edits, run:
   - `cd framework && npx tsc -p . 2>&1 | tail -10` — must produce no output (clean)
   - `cd framework && npm test 2>&1 | tail -10` — all 34 tests must pass

## Constraints
- Do NOT add new features; only fix/improve what exists.
- Do NOT modify test files or job specs.
- Keep command output filtered (`| tail -n 30`).
- No LLM calls in tests.

## Output
Report at most 10 lines: each issue found, the fix applied, and the final typecheck/test result.
