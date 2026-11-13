# Experiments

Problems, the job image and run outputs for the framework comparison. The specs are the source of
truth: [problems](../docs/specifications/features/problems.md) for the problem set and
[framework-runner](../docs/specifications/features/framework-runner.md) for metrics, grading,
budget and staged evaluation.

| Path | Contents |
|------|----------|
| `problems/<id>/` | One problem: `task.md` (the prompt), `task.json` (size, set, turn limit, tags), `Dockerfile`, `workspace/` (starting files), `checks/` (hidden tests + `check.sh`, never present during a job), `reference/` (reference solution). |
| `docker/aiw-base/` | Base image for job containers. |
| `runs/` | Run outputs (git-ignored). |
| `runs-archive/` | Archived old-format runs (git-ignored). |

## Commands

Run from the repo root (`npx aiw --help` lists every option):

```bash
npx aiw problems build            # build problem images
npx aiw problems check            # self-check: checks fail before, pass with the reference solution
npx aiw eval --problems dev --mode compare --tools S
npx aiw report <run-dir>... --name <report-name>
npx aiw view                      # results viewer
```

Modes: `baseline`, `branch-only`, `orchestrate`; `compare` runs all three. Measured runs use
`gpt-6-luna` on OpenAI Flex with a per-run `--budget` (framework-runner §4.1, §6.5).
