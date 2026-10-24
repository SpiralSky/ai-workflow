# Architecture: Tool Catalog

**Derived from:** [tools.md](../features/tools.md)  
**Package:** `@aiw/tools`

---

## 1. Structure

```
packages/tools/
  src/
    catalog.ts          ordered registry: S tools, then L groups (tools §5–6 order)
    s/                  bash, readFile, writeFile, edit, grep, findFiles
    l/fs/ l/nav/ l/graph/ l/refactor/ l/test/ l/check/ l/vcs/ l/external/
    sidecar.ts          client for the Python analysis sidecar
    cap.ts              8 KB output cap + truncation note
    paths.ts            workspace containment
  python/aiw_sidecar/   sidecar package (§4)
  fixtures/external/    canned data for `external` tools (§5)
```

Each tool is one file exporting a `ToolDef` = branching-framework §6.2 registration fields +
orchestrate §6 metadata. `catalog(tier, { root, sidecar })` returns the registered tools for a tier.
`LocalHost` in `@aiw/server` wraps this catalog as a `Host`.

---

## 2. Registration

- Descriptions and parameter docs are fixed strings in the tool file (tools §3.2); the same string
  is used for baseline schemas, branch declarations and selection.
- `whenToUse`, `whenNotToUse`, `examples`, `category`, `effect`, `requires`, `cost` are filled for
  every catalog tool (no derived defaults inside the catalog).
- A unit test enforces: unique names, L ⊇ S unchanged (tools §3.3), no tool in S changes between
  tiers, every description within the length budget.

> **Decided I-04 (2026-10-23):** description ≤ 200 chars, each parameter doc ≤ 80 chars, `whenToUse`
> ≤ 200 chars (orchestrate only, not shown to baseline/branch). At 53 tools this keeps tier L's
> schema near 5–7k tokens per turn. The unit test fails on any overrun and prints the measured S
> and L schema token counts, so the size is a known, recorded number.

---

## 3. Implementation notes per group

| Group | Implementation |
|-------|----------------|
| S | Node: `bash` via `child_process.spawn("bash", ["-lc", cmd])`, cwd `/work`, environment with secrets stripped (system-overview §7), timeout (default 60 s, arg `timeoutMs`), process group killed on abort; `grep`/`findFiles` via bundled ripgrep binary in the base image, falling back to a JS walk. |
| `fs` | Node. `multiEdit` validates all edits before writing any (atomic). |
| `nav`, `graph`, `refactor` | Python sidecar (§4). Results are capped and use `{ path, line, col? }` and `path#Name` (tools §4). |
| `test` | Python sidecar: `runTests` drives `unittest` programmatically and returns structured results (never raw logs); `coverage`/`traceCalls` via `sys.settrace`/`sys.monitoring` (3.12); `stressRun` spawns repeated runs with a parallelism arg. |
| `check` | Sidecar: types + lint (I-02); `format` uses the formatter configured in the workspace or none (throws `no formatter configured`). |
| `vcs` | `git` CLI. `diff` compares against the job's starting state: the server records a pristine snapshot of `/work` at startup (tar in `/tmp`, outside the workspace) so `diff`/`restore` work without a `.git` in `/work`; `history` returns `no history` when the workspace has no repository. |
| `external` | Fixture lookup (§5), `effect: external`. |

Every tool throws `unsupported language: <lang>` for files the backend doesn't handle (tools §4).

---

## 4. Python analysis sidecar

A long-lived Python 3.12 process started lazily by the tool server on first use, speaking
newline-delimited JSON-RPC over stdio: `{ id, method, params } → { id, result | error }`.
One sidecar per server session; restarted on crash (the in-flight call throws `sidecar crashed`).

- Runs from an isolated venv at `/opt/aiw/venv` (not on the workspace interpreter's path), with
  the workspace on `sys.path` for all `exec` tools, which execute workspace
  code in a **child** process so analysis state is never polluted.
- Methods map 1:1 to tool names; caching of parsed modules keyed by (path, mtime).

> **Decided I-02 (2026-10-23):** `ast` for outline/graphs/import cycles, `jedi` for
> definitions/references/signatures, `rope` for refactors (incl. `moveSymbol`, `moveModule`,
> `changeSignature`), no `coverage.py` (3.12 `sys.monitoring`), `ruff` binary for lint, and
> `pyright` for `check` (better inference and speed than `mypy`; Node is already in the image).
> A TypeScript backend is out of scope until a TS codebase exists (problems §9 Q1).

---

## 5. External tools and fixtures

`fixtures/external/<tool>.json` holds canned responses selected by simple argument matching
(first match on a list of `{ match: {...}, result }`, else a generic plausible default). Every
response is deterministic.

> **Decided I-03 (2026-10-23):** Canned fixtures only, shared by all problems, so "no problem needs
> these" stays true and every `external` call is pure overhead. Per-problem fixtures would mix
> irrelevant-tool cost with information benefit; if wanted, that is a separate experiment.

---

## 6. Base image and runtime mount

> **Decided A-04 (2026-10-23, approved):** All problem images build `FROM aiw-base:py3.12-<n>` (versioned), defined in
> `problems/_base/Dockerfile`:
> - `python:3.12-slim` (glibc) + `git` + `ripgrep`;
> - Node 22 at `/opt/aiw-node` (for the server and pyright);
> - tool venv at `/opt/aiw/venv` (jedi, rope, pyright, ruff) — outside the workspace
>   interpreter's import path.
>
> The **server bundle** (`aiw-server.mjs` + sidecar package) is **not** baked into images: the
> runner bind-mounts it read-only at `/opt/aiw/bundle` per job. Image digests then change only when
> the environment changes, while code changes are tracked by the commit in provenance.
> The base image is versioned (`aiw-base:py3.12-<n>`) and its digest is part of each problem
> image digest.

