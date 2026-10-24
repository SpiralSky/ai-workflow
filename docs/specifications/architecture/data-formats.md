# Architecture: Data Formats

**Derived from:** [framework-runner.md §7](../features/framework-runner.md), [viewer.md §9](../features/viewer.md)  
**Schemas:** `@aiw/telemetry` (events, transcript), `@aiw/report` (run files, reports)

All files carry a format version. Readers reject unknown versions; there is no migration of old
runs (project rule).

---

## 1. Run directory

Layout exactly as framework-runner §7. Job directory name: `<problem>.<framework-id>.<rep>`, where
`framework-id` is the canonical variant string with `[`/`]`/`,`/`=` kept (all valid on Linux; the
indexer URL-encodes them). Readers take problem, framework and rep from `job.json` (or the `job`
event), never by splitting the directory name, since variant values may contain `.`.

### 1.1 `run.json`

```json
{
  "format": 1,
  "id": "2026-10-23T14-02-11Z-a1b2",
  "status": "complete" | "in-progress" | { "invalid": "budget" | "job-failed:<job>" | "interrupted" },
  "config": { "problems": [...], "frameworks": [...], "tier": "S", "reps": 1, "budgetUsd": 0.5,
              "concurrency": 2, "models": { "main": "...", "secondary": "..." }, "temperature": 0,
              "secondaryCap": 4, "branch": { "context": "trace", "timeoutMs": 120000,
              "limits": { "valueChars": 200, "loopCollapse": 3, "eventBudget": 60 } } },
  "provenance": {
    "commit": "…", "dirty": false, "runnerVersion": "…",
    "basePrompt": "<sha256>",
    "frameworks": { "<framework-id>": { "prompt": "<sha256>", "tools": "<sha256>",
                    "extra": { "executor": "<sha256>", "rerank": "<sha256>", "hotPaths": "<sha256>" } } },
    "images": { "<problem>": "sha256:…" },
    "problems": { "<problem>": { "taskHash": "…", "turnLimit": 20 } }
  },
  "totals": { "jobs": 30, "attempts": 31, "costUsd": 0.41, "pass": 27, "fail": 3 },
  "startedAt": "…", "endedAt": "…"
}
```

### 1.2 `job.json`

```json
{
  "format": 1, "problem": "07-async-race", "framework": "branch-only", "rep": 0,
  "outcome": "pass" | "fail",
  "reason": null | "checks" | "turn-limit" | "timeout" | "patch-failed",
  "attempts": [ { "n": 0, "infraError": "HTTP 429 …", "costUsd": 0.003 }, { "n": 1, "final": true } ],
  "costUsdAllAttempts": 0.014,
  "rollups": { /* telemetry §7 */ },
  "durationMs": 81234
}
```

### 1.3 `events.jsonl`, `transcript.jsonl`, `blobs/`

See [telemetry §3](telemetry.md#3-event-schema) and [§5](telemetry.md#5-transcripts). Blob files are
`blobs/<sha256>.txt`; JSON blobs (tool declarations) are stored as canonical JSON text.

### 1.4 `diff.patch`, `check.log`

`git diff --binary` format with paths relative to `/work`; raw `check.sh` stdout+stderr with a
final line `exit <code> (<ms> ms)`.

---

## 2. Attachments

| Key | Producer | Data |
|-----|----------|------|
| `branch.events` | branch runtime | full untruncated `TraceEvent[]` (core-branch §5) |
| `branch.trace` | branch runtime | model-facing rendered text |
| `branch.source` | branch runtime | program source (also in the transcript; duplicated so the viewer needs no lookup) |
| `orchestrate.handoff` | orchestrate engine | handoff record (orchestrate §8.4) |
| `orchestrate.step` | orchestrate engine | `{ step: "s3", changed: [...], saved: [...] }` |

Attachments are inspection data only and never aggregated (framework-runner §5.4).

---

## 3. In-progress runs

While a run is in progress `run.json` has `status: "in-progress"` and is rewritten atomically
(write temp + rename) after each job. Job directories without `job.json` are in progress or crashed;
the viewer shows them from `events.jsonl` alone, marked incomplete (viewer §9).

---

## 4. Combined report

`experiments/reports/<name>/report.json`:

```json
{
  "format": 1, "name": "small-S-oct", "runs": ["<run-id>", "..."],
  "provenance": { /* the common "must match" fields */ },
  "frameworks": {
    "<framework-id>": {
      "jobs": 15, "pass": 14, "passRate": 0.933, "wilson95": [0.70, 0.99],
      "costPerSuccessUsd": 0.0041, "meanCostUsd": 0.0038,
      "turns": { "main": 6.1, "secondary": 0 }, "toolCalls": { "topLevel": 5.2, "leaf": 11.4 },
      "failures": { "checks": 1 }, "gate": "ok" | { "flagged": ["<problem>", "..."] }
    }
  },
  "paired": [ { "problem": "07-async-race", "a": "branch-only", "b": "baseline",
                "passA": 3, "passB": 2, "costA": 0.011, "costB": 0.019 } ],
  "orchestrate": { /* orchestrate §10.1 metrics when present */ },
  "tools": { /* tools §8 metrics */ }
}
```

`report.md` is a human-readable rendering of the same data. Neither is stored inside a run
directory (framework-runner §7).
