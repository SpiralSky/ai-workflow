# Feature: Tool Catalog

**Status:** Draft  
**Area:** Evaluation / tools  
**Related:** [framework-runner.md](framework-runner.md), [problems.md](problems.md), [branching-framework.md](branching-framework.md), [orchestrate.md](orchestrate.md), [references.md](references.md)

---

## 1. Summary

One registry of tools, shared by every framework under test, offered in two **tiers**:

- **S (small)** — the usual coding-agent set (~6 tools). Enough to solve every problem.
- **L (large)** — S plus structure-aware, code-graph, refactoring, test, VCS tools and a set of
  realistic tools that no problem needs (~45 tools). Shaped like a real harness with several MCP
  servers attached.

The **catalog** (which tools exist) is held constant across frameworks within a run. **Exposure**
(how tools reach the model) belongs to each framework and is what is being measured:

| Framework | Exposure |
|-----------|----------|
| baseline | every tool schema, every turn |
| branch | TS declarations of every tool in the `branch` description |
| orchestrate | planner sees none; executor sees a shortlist (orchestrate §7) |

---

## 2. Motivation

Fewer tools means fewer prompt tokens and better tool choice, so baseline and branch should do best
with S. Orchestrate's purpose is to cope with large catalogs, so at S it is mostly overhead.
Tuning a "best" set per framework would be expensive and hand the experimenter a free choice that
is hard to defend. Running every framework at both tiers instead gives:

- each framework's result at its likely-best tier,
- the cost of adding tools for each framework (S → L delta),
- whether orchestrate at L beats baseline/branch at L, and at S.

A medium tier can be added later if the S/L results leave the crossover unclear.

---

## 3. Fairness rules

1. **One implementation per tool.** All frameworks call the same function with the same output
   cap and truncation rule. Only presentation differs.
2. **Same descriptions.** `description` and parameter docs are identical for every framework.
   Orchestrate-only metadata (`whenToUse`, `examples`, …) is part of orchestrate's mechanism and
   is allowed.
3. **Tiers are cumulative.** L ⊇ S. Nothing in S is renamed or changed in L.
4. **Tier is run configuration** (`--tools S|L`), recorded in provenance
   (framework-runner §7.1). Runs combine only within a tier.
5. **No LLM-backed tools in either tier** (`llm`, `weakLLM`, `classify`). They would add hidden
   model cost unevenly; orchestrate's executor already is the secondary LLM.
6. **Deterministic.** Every tool runs inside the job container (framework-runner §6.4). External
   tools in L use fixture data; none make real network calls.

---

## 4. Tool contract

All tools follow branching-framework §6.1 (one argument object, structured return, throw on
failure) and register with branching-framework §6.2 plus orchestrate §6 metadata. In addition:

- **Output cap.** Every tool returns at most a fixed size (default 8 KB). Truncated results say so
  and say how to get the rest (`range`, `offset`, a narrower query).
- **Locations** are `{ path, line, col? }`; symbols are addressed as `path#Name` or
  `path#Class.method` — the same form as references.md code references.
- **Write tools return a change summary**, not the new file: `{ files: [{ path, added, removed }],
  diff? }`. `diff` is included when small.
- **Refactoring tools take `dryRun`** and return the diff without writing.
- **Language.** Contracts are language-agnostic. The first implementation targets Python, which
  every current problem uses. A tool that does not support a file's language throws
  `unsupported language: <lang>` rather than guessing.

---

## 5. Tier S — core

| Tool | Effect | Purpose |
|------|--------|---------|
| `bash` | write | Run a shell command; returns `{ code, out }`. Tests, scripts, anything else. |
| `readFile` | read | Read a file, optional line `range`. Line-numbered. |
| `writeFile` | write | Create or overwrite a file. |
| `edit` | write | Exact string replace in one file; fails if not unique unless `all: true`. |
| `grep` | read | Regex search over contents; `path`/`glob` filters; returns locations with a line of context. |
| `findFiles` | read | Glob over file names. |

These match the current baseline tools, so S results stay comparable with earlier runs.

---

## 6. Tier L — additions

Grouped by orchestrate `category`. Names are chosen so that no two tools do the same job
(orchestrate §6.1). Where two tools look close, the `whenNotToUse` line is given.

### 6.1 `fs` — files

| Tool | Effect | Purpose |
|------|--------|---------|
| `multiEdit` | write | Several exact replacements across one or more files, applied atomically. |
| `moveFile` | write | Move or rename a file. Does **not** fix imports — use `moveModule` for source files. |
| `deleteFile` | write | Delete a file. |
| `listDir` | read | Directory tree to a given depth, with sizes. Not for pattern matching — use `findFiles`. |

### 6.2 `nav` — reading code by structure

| Tool | Effect | Purpose |
|------|--------|---------|
| `outline` | read | Symbols in a file (classes, functions, methods, constants) with signatures and line ranges, no bodies. Also works on Markdown (headings) and JSON/YAML (top-level keys). |
| `readSymbol` | read | Source of one symbol (`path#Name`), optionally with its docstring only. |
| `findDefinition` | read | Where a name is defined, resolved through imports. |
| `findReferences` | read | Every usage of a symbol (calls, imports, annotations, attribute access) with a line of context. Not for multi-hop questions — use `callGraph`. |
| `signature` | read | Signature, type annotations, docstring and inferred types for a symbol. Cheap check before calling or changing it. |

### 6.3 `graph` — the codebase as a graph

These answer structural questions without reading source. Results are node/edge lists, capped,
with symbols as `path#Name`.

| Tool | Effect | Purpose |
|------|--------|---------|
| `overview` | read | Modules, entry points, public API, largest/most-connected symbols, test files and what they import. First look at an unfamiliar codebase. |
| `callGraph` | read | Callers and/or callees of a symbol to depth *n* (`direction: in\|out\|both`). |
| `importGraph` | read | Module import edges for a module or the whole package, with **cycles** flagged and the import line that closes each cycle. |
| `impact` | read | What a change to a symbol could affect: transitive callers, subclasses/overrides, and the tests that reach it. Used before editing shared code. |
| `dataFlow` | read | Where a value or attribute is written and read (`path#Class.attr`, module globals), including writes from other threads/tasks when detectable. |

### 6.4 `refactor` — semantic edits

All update every reference, import and re-export, take `dryRun`, and return a change summary
(§4). They fail rather than producing a partial change.

| Tool | Effect | Purpose |
|------|--------|---------|
| `renameSymbol` | write | Rename a function, class, method, variable, parameter or attribute everywhere. |
| `moveSymbol` | write | Move a function/class/constant to another module (created if missing); rewrites imports in all users; leaves a re-export only if `keepReexport: true`. |
| `moveModule` | write | Move or rename a module/package and rewrite every import of it. |
| `extractFunction` | write | Turn a line range into a new function (name given), replacing it with a call. Parameters and return values are inferred. |
| `inlineSymbol` | write | Replace calls to a function, or uses of a variable, with its body/value, then remove it. |
| `changeSignature` | write | Add (with default), remove, rename or reorder parameters; updates every call site. |
| `extractVariable` | write | Pull an expression into a named variable or module constant. |
| `organizeImports` | write | Remove unused imports, sort, and move function-local imports to the top when safe. |

### 6.5 `test` — running and probing

| Tool | Effect | Purpose |
|------|--------|---------|
| `runTests` | read | Run tests (all, a file, a `path#test` id, or `failedOnly`). Returns `{ passed, failed: [{ id, message, location, excerpt }] }` — never the raw log. |
| `listTests` | read | Test ids, optionally filtered to tests that reach a symbol. |
| `coverage` | read | Lines/branches of a file or symbol executed by a test run; marks uncovered lines. |
| `runSnippet` | read | Run a short Python snippet with the workspace importable; returns stdout, stderr, return value or exception with traceback. For reproducing a bug without writing a file. |
| `traceCalls` | read | Run a snippet or test and record calls to chosen symbols: arguments, return value or exception, thread/task id, order. For race conditions and "wrong value reaches X" bugs. |
| `stressRun` | read | Run a test or snippet *n* times (optionally in parallel) and report the failure rate and first distinct failures. For flaky/concurrency bugs. |

`runTests` and `bash` overlap in ability (bash can run pytest) but not in output; `runTests`
`whenToUse` says it is the default for tests and `bash`'s says it is not.

### 6.6 `check` — static checks

| Tool | Effect | Purpose |
|------|--------|---------|
| `check` | read | Type check and lint a file or the workspace (`kinds: ["types", "lint"]`, default both). Structured diagnostics. |
| `format` | write | Apply the project formatter to files. |

### 6.7 `vcs` — history and undo

| Tool | Effect | Purpose |
|------|--------|---------|
| `diff` | read | Working-tree changes (status + diff), whole tree or one path. The executor's way to report what it changed. |
| `history` | read | Log and blame for a file, line range or symbol. |
| `restore` | write | Discard working-tree changes to a path (undo a bad edit). |

### 6.8 `external` — realistic but unneeded

No current problem needs these. They exist so L looks like a real harness, to measure the cost of
irrelevant tools for baseline/branch and selection precision for orchestrate. Each returns
plausible fixture data and is `effect: external`.

| Tool | Purpose |
|------|---------|
| `issues` | Search/read issues in a tracker (`op: search\|get\|comment`). |
| `pullRequests` | List/read PRs and review comments. |
| `ciStatus` | Latest CI runs and failing jobs for a branch. |
| `httpRequest` | Make an HTTP request to a service. |
| `fetchUrl` | Fetch a web page as text. |
| `webSearch` | Search the web. |
| `sqlQuery` | Read-only query against the app database. |
| `packageInfo` | Versions, changelog and docs link for a dependency. |
| `installPackage` | Install a dependency into the environment. |
| `docsSearch` | Search internal documentation/wiki. |
| `notify` | Post a message to a team channel. |
| `containerLogs` | Tail logs from a running service container. |
| `metrics` | Query time-series metrics for a service. |
| `featureFlags` | Read/set feature flags. |

Calls to `external` tools are counted separately in reports (§8); a call is not an error, but it
is wasted cost.

### 6.9 Size

S: 6. L: 6 + 4 + 5 + 5 + 8 + 6 + 2 + 3 + 14 = **53**.

---

## 7. Problems that exercise L

On small problems (1–4 files) most L tools are at best a shortcut, so L mostly measures overhead
there. The large problems in [problems.md §8.3](problems.md) exist to exercise them: rename
(`renameSymbol`), module split (`moveSymbol`, `importGraph`), import cycle (`importGraph`,
`moveSymbol`), signature change (`changeSignature`, `findReferences`) and a bug far from its
symptom (`callGraph`, `dataFlow`, `impact`). Each problem lists its `expectedTools`.

---

## 8. Metrics

In addition to framework-runner and orchestrate §10 metrics, per tier and framework:

- **Tool-schema tokens per turn** (baseline/branch) or per executor (orchestrate).
- **Calls per tool**, and tools never called across a run (candidates to drop).
- **External-tool calls** (§6.8).
- **Refactor vs manual edits:** share of changes made by `refactor` tools vs `edit`/`multiEdit`.
- **S → L delta** in cost, turns and pass rate, per framework.

---

## 9. Open questions

1. **Implementation backends.** Python: `rope` for refactors, `jedi`/`pyright` for navigation and
   types, `coverage.py` + `sys.settrace`/`sys.setprofile` for `coverage`/`traceCalls`, `ast` for
   graphs. TS later via `ts-morph` / tsserver. Or one LSP client for every language, with
   refactors that the LSP lacks (`moveSymbol`) done separately.
2. **Description length.** Longer descriptions help choice but cost baseline/branch every turn.
   Fix a length budget per tool so that L's schema size is a known number.
3. **Fixture realism for `external`.** Fixed canned responses or small per-problem fixtures
   (e.g. an issue that restates the bug)? The latter makes some tools useful, which changes what
   L measures.
4. **Medium tier.** Only if S/L results leave the crossover unclear.

---

## 10. Out of scope

- How each framework exposes tools (branching-framework §6.4, orchestrate §7).
- Problem definitions ([problems.md](problems.md)).
- Harness tools brought in by the operator outside the eval (branching-framework §6.3).
