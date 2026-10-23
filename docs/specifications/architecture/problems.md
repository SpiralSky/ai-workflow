# Architecture: Problem Pipeline

**Derived from:** [problems.md](../features/problems.md), [framework-runner.md §6.1, §6.4](../features/framework-runner.md)  
**Code:** `@aiw/runner` → `src/problems/`; data in `problems/`

---

## 1. Overview

```
_codebases/<cb>/ ──┐
<id>/overlay/   ───┴─ aiw problems build ─▶ <id>/workspace/ ─┐
<id>/Dockerfile (FROM aiw-base) ──────── docker build ───────┴▶ image aiw/<id>:<task-hash>
<id>/checks/, reference/ ──────────────── aiw problems check ──▶ <id>/.selfcheck.json
```

---

## 2. Layout

As problems §3 and §6, plus two generated files:

```
problems/
  _base/Dockerfile                       aiw-base (tool-catalog §6)
  _codebases/fulfil/                     clean codebase + its tests
  <id>/
    task.md  task.json  Dockerfile
    overlay/                             large problems only (problems §3)
    workspace/                           built (A-21)
    checks/  check.sh
    reference/solution.patch  reference/notes.md
    .dockerignore                        generated: everything except workspace/
    .selfcheck.json                      generated: last self-check result + task hash
```

- **Build context isolation.** The Dockerfile is built with `problems/<id>/` as context and a
  generated `.dockerignore` that admits only `workspace/`, so `checks/` and `reference/` can never
  enter the job image. Standard Dockerfile:
  ```Dockerfile
  FROM aiw-base:py3.12-<n>
  COPY workspace/ /work/
  WORKDIR /work
  ```
- **Image tag** `aiw/<id>:<task-hash>` (task hash as in [runner §9](runner.md#9-provenance)), so a
  changed task folder can never reuse a stale image.

> **Decided I-05 (2026-10-23):** The smoke test is an ordinary problem folder,
> `problems/01-chunk-off-by-one/`, with `task.json` `size: "smoke"`. It follows every rule of §3
> (layout, checks, reference, self-check). `all` = `small` + `large`, so it is never selected by
> a set or reported in combined reports; `--problems smoke` or its id runs it.

---

## 3. Build

`aiw problems build [<id>]` for large problems:

1. Verify the codebase's own tests pass (`python -m unittest` in a `aiw-base` container).
2. Copy `_codebases/<cb>/` → `<id>/workspace/`, then copy `overlay/` over it (files in overlay replace
   or add; a `overlay/.delete` list removes files).
3. Strip anything that could leak the answer (`.git/`, `__pycache__/`).

> **Decided A-21 (2026-10-23, approved):** Commit the built `workspace/` of large problems. The problem folder is then
> self-contained as the runner expects, the task hash covers exactly what the model sees, and
> overlay mistakes are visible in review. A CI-style test fails if a committed workspace differs
> from a fresh build.

---

## 4. Self-check

`aiw problems check [<id>]` implements problems §7 using the runner's own grading code
([runner §6](runner.md#6-grading)), so self-check and grading cannot diverge:

| Step | Implementation |
|------|----------------|
| 1 | Build workspace (large) and image; codebase tests pass |
| 2 | Grade the unmodified workspace (empty diff) → must fail |
| 3 | Grade with `reference/solution.patch` as the diff → must pass |
| 4 | Step 3 five times → all pass |
| 5 | `notes.md` front-matter lists `fixWords: [...]`; `task.md` must contain none (case-insensitive, word boundaries) |

Additionally (problems §5.6): checks must finish in < 30 s (measured in step 3; warning at 20 s).
The result, with the task hash, is written to `.selfcheck.json`; `aiw eval` refuses problems whose
stamp is missing, failing, or for a different hash.

---

## 5. Codebase `fulfil`

Written as source under `problems/_codebases/fulfil/` per problems §6.2. Authoring is
implementation work (problems §9 Q2 decides who writes it); the pipeline above only requires that
its tests pass and that each large problem's overlay is small and focused (bug injection or
precondition setup for L1–L5).
