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

> **Decided A-30 (2026-10-24):** Implementation details where tools.md is silent:
> - **`ToolDef`** = `{ name, description, parameters, returns?, meta, fn(args, ctx) }`, `ctx = { root,
>   signal, env? }`. Catalog tools set `capsOutput: false`; core `capOutput` enforces the 8 KB cap.
>   List results cut earlier (count and ~6 KB) and set `truncated` to a hint string.
>   `catalog(tier, { root, snapshot?, sidecar? })`; `L` throws until all 53 tools exist.
> - **`cost`** is a 1–3 relative scale (1 cheap read, 3 shell/exec).
> - **`bash`**: timeout → `code: 124`, abort → `code: 130`, with a note appended to `out`; the
>   process group is SIGKILLed. Env from `toolEnv` (strips `OPENAI_*`, `ANTHROPIC_*`,
>   `OPENROUTER_*` and names in `AIW_SECRET_NAMES`).
> - **`readFile`**: `range: [start, end]` (1-based, inclusive), `cat -n` style numbering; over the
>   cap it stops at a line boundary with `[truncated at line N of M; pass range to read more]`.
> - **`grep`** returns `{ matches: [{ path, line, text }] }`; the matching line is the line of
>   context (clipped to 200 chars). `rg` is primary (always in the base image); the JS walk is a
>   dev fallback and uses JS `RegExp`, so exotic regex syntax can differ between them. A glob
>   without `/` matches basenames at any depth.
> - **Write summaries**: unified diff (3 context lines) included when ≤ 2 KB. `moveFile` and
>   `deleteFile` act on single files only; a move counts all source lines `removed` and all target
>   lines `added`; a delete counts all lines `removed`. `moveFile` refuses to overwrite unless
>   `overwrite: true`.
> - **`listDir`** returns a flat pre-order `{ entries: [{ path, type, size }] }`, default depth 2,
>   directory size = total bytes below it; symlinks skipped.
> - **`vcs`**: the pristine snapshot is a tar in `os.tmpdir()/aiw-snapshot-*` (excluding `.git` and
>   `node_modules`), extracted lazily, removed on exit; without one `diff`/`restore` throw
>   `no snapshot`. `restore` also deletes files added since the snapshot. `history` takes
>   `range: [start, end]` or `symbol` (`Name` or `path#Name`; `git log -L :Name:path`).
> - **Parameter-doc budget** (I-04) is checked for top-level parameters only.

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

> **Decided A-32 (2026-10-24):** Sidecar and `nav`/`check` details:
> - Interpreter `$AIW_VENV/bin/python` (default `/opt/aiw/venv`); dev venv `packages/tools/.venv`
>   from pinned `python/requirements.txt` (`npm run setup:venv`). Workspace root is `argv[1]`;
>   requests are served one at a time. Start failure rejects with `sidecar failed to start`; an
>   abort rejects only that call with `aborted`.
> - Targets are `symbol` (`path#Name`), or `path` + `name` (optional `line`), or `path` + `line` +
>   `col`; lines and columns are 1-based. Definitions outside the workspace have `module`, no
>   `path`; `findReferences` drops references outside the workspace and in `.venv`/`node_modules`.
> - Only `outline` handles Markdown/JSON/YAML (YAML by top-level-key scan, no PyYAML); the other
>   `nav` tools and `check`/`format` are Python-only.
> - `check` severities: pyright's, `information` → `info`; ruff → `warning` (`error` for syntax
>   errors). `format` is configured by `[tool.ruff.format]` or `[tool.black]` in `pyproject.toml`, or
>   a `format` table in `ruff.toml`/`.ruff.toml`; both run `ruff format` (black configs carry over
>   `line-length` only).

## 5. External tools and fixtures

`fixtures/external/<tool>.json` holds canned responses selected by simple argument matching
(first match on a list of `{ match: {...}, result }`, else a generic plausible default). Every
response is deterministic.

> **Decided A-31 (2026-10-24):** File shape `{ cases: [{ match, result }], default }`. A case
> matches when every `match` key fits: a string matches a string argument as a case-insensitive
> substring; other values must be JSON-equal; a missing argument never matches. Result strings may
> use `{{argName}}` placeholders filled from the call, so defaults echo their input. `sqlQuery`
> rejects non-read statements; `installPackage` installs nothing.

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
> The **server bundle** (`aiw-server.mjs` + sidecar packages, including `isolated-vm`) is **not** baked into images: the
> runner bind-mounts it read-only at `/opt/aiw/bundle` per job. Image digests then change only when
> the environment changes, while code changes are tracked by the commit in provenance.
> The base image is versioned (`aiw-base:py3.12-<n>`) and its digest is part of each problem
> image digest.

