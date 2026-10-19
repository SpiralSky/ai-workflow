# AI Workflow — Branch Framework

An experiment comparing three agentic coding strategies on small Python repair/feature tasks.

## The Two Workflows

### branch-only
The model emits a short TypeScript program as a single `branch` MCP tool call instead of many atomic tool calls. The program runs synchronously in a worker thread with helper functions (`readFile`, `edit`, `bash`, `runTests`, etc.). When the program calls `returnUser("…")`, the turn ends.

**Goal:** Fold a predictable multi-step sequence (read → fix → test → report) into one LLM turn, cutting context growth and round-trips.

**Current limitation:** TypeScript cognitive overhead causes syntax errors and `returnUser` misuse. The single-tool constraint is also somewhat artificial — real Claude Code lets the model use many tools.

### orchestrate
Two-tier architecture: the main LLM gets only a `delegate` tool; it hands off precise subtasks to a secondary LLM that writes TypeScript branch programs. A BM25 shortlist pre-injects relevant composite tools into the secondary's context.

**Goal:** Keep the coordinator high-level (never touches file contents), let the executor handle all file work.

**Current limitation:** File listing is pre-injected passively — the coordinator gets context it didn't ask for rather than discovering it actively.

### baseline (control)
Standard atomic tool calls: Bash, Read, Edit, Write, Glob, Grep. No branch tool. Used as the comparison baseline.

---

## Current Results (2026-10-18, DeepSeek v3, 9 problems × 3 runs)

| Mode | Pass rate | Notes |
|------|-----------|-------|
| baseline | 20/27 (74%) | |
| orchestrate | 17/27 (63%) | |
| branch-only | 12/27 (44%) | |

**⚠ These scores are partially contaminated.** `orchestrate-system.md` had per-problem hints (p04, p06, p07) that gave orchestrate an unfair advantage. Those hints were stripped on 2026-10-19 — a clean rerun is needed before drawing conclusions.

---

## Unfinished / Next Steps

### Immediate
- [ ] Rerun eval on p04, p06, p07 (and ideally all problems) after hint removal to get clean scores
- [ ] Investigate p01 and p09 (0/3 orchestrate failures in last run)
- [ ] Analyze `failReason` distribution across modes (turn-limit vs. no-edit vs. wrong-edit)

### Proposed redesigns (not yet implemented)

**orchestrate-active:** Replace passive file-listing injection with an active coordinator that uses tools to discover context on demand:
- `list_files` — raw file tree for orientation
- `grep(pattern)` / `find_symbol(name)` — targeted lookup without reading contents
- `get_structure(path)` — semantic digest (exports, imports, class/function names), no raw content
- `delegate(task, context)` — hand off a subtask with exactly the context the executor needs

No `read_file` for the coordinator — the tool set is the constraint that keeps it high-level. BM25 shortlist becomes a live `grep` the coordinator calls when needed.

**branch-python:** Replace TypeScript with Python as the execution language. Models are trained on far more Python than custom TS DSLs; helpers map naturally to Python functions. The "done vs. continue" signal becomes implicit (no tool call = done), removing the `returnUser` misuse failure mode.

### Fairness baseline for next experiment
Before running: ensure all three modes have equivalent prompt quality (no per-problem hints in any of them), then compare:
- **baseline** — unchanged atomic tools
- **branch-python** — single tool, Python execution
- **orchestrate-active** — coordinator with list/grep/structure/delegate, no pre-injection

---

## Layout

| Path | What |
|---|---|
| `framework/` | MCP server, hooks, prompt parts, tests. Self-contained; see [framework/README.md](framework/README.md). |
| `experiments/` | Eval harness (`run.ts`) + 9 Python problems (`problems/0N-*`). Output in `experiments/runs/<ts>/` (gitignored). |
| `experiments/viewer/` | Self-contained HTML dashboard (`index.html`). Build with `cd framework && npm run view`. |
| `dev/jobs/` | Specs for framework dev tasks; `_common.md` prepended to each. |
| `dev/run-job` | Runs a job spec; results in `dev/out/` (gitignored). |
| `docs/` | Design docs. |

## Running

```bash
cd framework && ./setup.sh                        # once / after moving: deps, config, tests, tsc
cd framework && npm test && npx tsc -p .          # after every change (no LLM calls)

# Full eval (requires OPENAI_BASE_URL + OPENAI_API_KEY for OpenRouter):
OPENAI_BASE_URL=https://openrouter.ai/api/v1 OPENAI_API_KEY=<key> \
  npm run eval -- --problem all --mode compare --n 3 --model deepseek/deepseek-chat-v3-0324

# Retry only failed jobs from a prior run:
OPENAI_BASE_URL=... OPENAI_API_KEY=<key> \
  npm run eval -- --retry-failed <run-dir-timestamp> --mode orchestrate --n 3 --model deepseek/deepseek-chat-v3-0324

# View results:
cd framework && npm run view   # then open experiments/viewer/index.html
```

**Model:** Use `deepseek/deepseek-chat-v3-0324` only via OpenRouter. Do not use Claude/Anthropic models — too expensive.

Generated files (`framework/mcp.json`, `framework/settings.json`, `framework/prompt/.system.<mode>.md`) contain absolute paths and are not committed; `setup.sh` / `bin/claude-branch` / eval regenerate them.

Current state and detailed notes: [HANDOFF.md](HANDOFF.md).
