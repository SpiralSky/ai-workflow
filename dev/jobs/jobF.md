Task F — restructure project to be framework-focused.

## Context
Working dir: /home/spiralsky/projects/ai-workflow

Current layout:
  framework/        — MCP server (main product)
  eval/run.ts       — eval harness (one lonely file)
  loop-testbed/     — 5 Python problems + README + TEMPLATE.md (eval target)
  dev/jobs/, dev/run-job — dev workflow
  docs/PLAN.md      — design doc
  README.md, HANDOFF.md

## Problem
The framework is the main product but the repo is named/framed around "experiments".
eval/ has a single file separated from the problems it runs against (loop-testbed/).
There is no clear place to add a new experiment — it's not obvious how the pieces connect.

## Goal
Consolidate eval + loop-testbed into a single `experiments/` directory so the eval
harness and its test problems live together. Update all cross-references.

## Specific changes

### 1. Create experiments/ structure
- Move eval/run.ts → experiments/run.ts
- Move loop-testbed/problems/ → experiments/problems/ (the whole subdirectory)
- Move loop-testbed/README.md → experiments/README.md (update path references inside it)
- Move loop-testbed/TEMPLATE.md → experiments/TEMPLATE.md
- Remove now-empty eval/ and loop-testbed/ directories

### 2. Update internal paths
- experiments/run.ts line ~11: `join(ROOT, "loop-testbed", "problems")` → `join(ROOT, "problems")`
  (ROOT is the repo root, experiments/run.ts is one level up from problems/)
  Wait - ROOT in eval/run.ts is computed as dirname(dirname(__filename)), i.e. the repo root.
  After move: experiments/run.ts, ROOT = dirname(dirname(fileURLToPath(import.meta.url))).
  That still gives the repo root. So the path should become `join(ROOT, "experiments", "problems")`.
- experiments/run.ts line ~86: comment mentions `eval/runs/<ts>/` → update to `experiments/runs/<ts>/`

### 3. Update framework/package.json
- "eval": "tsx ../eval/run.ts" → "eval": "tsx ../experiments/run.ts"

### 4. Update framework/test/runner.test.ts
- `../../loop-testbed/problems/01-chunk-off-by-one` → `../../experiments/problems/01-chunk-off-by-one`

### 5. Update framework/README.md
- `../eval/run.ts benchmark` → `../experiments/run.ts benchmark`

### 6. Update .gitignore
- `eval/runs/` → `experiments/runs/`

### 7. Update README.md
Reframe the project: framework is the primary product; experiments test it.
Update the Layout table:
- eval/ row → experiments/ row: "Eval harness (run.ts) + test problems (problems/). Run: cd framework && npm run eval -- --help"
- loop-testbed/ row: remove (merged into experiments/)
Keep everything else the same.

### 8. Update HANDOFF.md
- Change `eval/runs/` references → `experiments/runs/`
- Change `loop-testbed/` references → `experiments/problems/`
- Change `eval/run.ts` reference → `experiments/run.ts`

Do NOT change dev/jobs/*.md (historical, leave as-is).
Do NOT change docs/PLAN.md (historical design doc, leave as-is).

## Acceptance checks
Run these after making changes:
1. `ls experiments/` shows: run.ts, problems/, README.md, TEMPLATE.md
2. `ls eval/` fails (directory gone)
3. `ls loop-testbed/` fails (directory gone)  
4. `cd framework && npm test 2>&1 | tail -5` — all 34 pass
5. `cd framework && npx tsc -p . 2>&1` — no output (clean)
6. `cd framework && node -e "import('./package.json', {assert:{type:'json'}}).then(m=>console.log(m.default.scripts.eval))"` shows the new path
7. `grep -r "loop-testbed\|eval/run\|eval/runs" . --include="*.ts" --include="*.json" --include=".gitignore" --include="*.md" | grep -v "node_modules\|dev/jobs\|dev/out\|docs/PLAN"` — only experiments/ and HANDOFF internal refs remain (no stale references)

## Output
Report: files moved/edited, test results, any issues.
