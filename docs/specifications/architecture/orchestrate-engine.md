# Architecture: Orchestrate Engine and References

**Derived from:** [orchestrate.md](../features/orchestrate.md), [references.md](../features/references.md)  
**Package:** `@aiw/core` → `src/orchestrate/`, `src/refs/`

---

## 1. Modules

| Module | Responsibility | Spec |
|--------|----------------|------|
| `task.ts` | `Task`: one per session (runner: one job; harnesses: the session id from session context, so a new id, e.g. after /clear, starts an empty store) — steps, reference store, change tracker, lock | references §7 |
| `planner-tools.ts` | `do` and planner `resolve` handlers and descriptions | orchestrate §4.1 |
| `selection/` | `retrieve.ts` (BM25), `rerank.ts` (pluggable, `llm` by default, `none` to disable), `complete.ts`, `index.ts` | orchestrate §7 |
| `executor.ts` | Executor session: prompt, loop, budget, last-turn notice | orchestrate §4.2, §8 |
| `report.ts` | Report validation, appended lines, size cap | orchestrate §8.3, references §6.4 |
| `handoff.ts` | Handoff record assembly | orchestrate §8.4 |
| `refs/parse.ts` | Reference grammar and validation | references §4 |
| `refs/store.ts` | Snapshot and named values, versions, eviction | references §3, §6, §7 |
| `refs/resolve.ts` | Inline vs handle, slicing, live code refs, staleness | references §5 |
| `changes.ts` | Workspace change tracking | §7 below |

---

## 2. Planner tools

- `do({ instruction, tools? })` → report text (MCP text result). Errors that are the planner's to fix
  (unknown reference, unknown tool name in `tools`) are returned as `isError: true` **before** any
  executor starts (references §4).
- `resolve({ ref, grep?, lines? })` → value capped at ~1k tokens (estimated as 4 chars/token, cap
  4 000 chars) with a truncation note (orchestrate §4.1). Reported as a top-level `tool` event so
  "planner `resolve` calls per task" is a plain count (orchestrate §10.1).

---

## 3. Lifecycle of a `do` call

```
validate refs ─▶ select ─▶ acquire lock ─▶ snapshot workspace ─▶ executor loop ─▶ finalise report
      │                                                                   │
      └── isError to planner                    step stored (sN), lock released, handoff attached
```

1. **Validate references** in `instruction`; on failure return the error listing valid references (no step id is used).
2. **Allocate step** `sN` (monotonic per task) and a reporter scope under the `do` tool event.
3. **Select** the shortlist (§4).
4. **Lock** (§3.3).
5. **Snapshot** the workspace (§7).
6. **Resolve references** for the handoff (§6.2) and build the executor's first request (§5.1).
7. **Run** the executor (§5.2).
8. **Finalise** the report (§5.4); store the step (instruction, report, trace calls as `sN.cK`).
9. **Attach** the handoff record (§8); release the lock.

### 3.3 Parallel `do` calls

Orchestrate §5 allows parallel `do` calls only when every shortlist in the batch is read-only.
Shortlists are only known after selection, and MCP delivers calls one at a time, so the batch rule
is implemented as a read/write lock on the task:

- A `do` whose final shortlist contains only `effect: read` tools takes a **shared** lock.
- Any other `do` takes an **exclusive** lock. Waiters are served in arrival order.
- `findTools` escalation that adds a non-read tool upgrades the lock (release shared, wait for
  exclusive) before the new tool becomes callable.

This produces the spec's outcome: read-only batches run concurrently; anything that can write runs
alone.

> **Decided A-10 (2026-10-23, approved):** The runner dispatches all framework-tool calls of one assistant turn
> concurrently and relies on this lock; catalog-tool calls in `baseline` are dispatched
> sequentially (A-25, [runner §4.3](runner.md#43-tool-dispatch)). In harnesses, concurrency is
> whatever the harness does; the lock gives the same guarantee.

---

## 4. Selection pipeline

```ts
interface Selector {
  select(q: { instruction: string; override?: string[] }, catalog: ToolDecl[]):
    Promise<Selection>;   // ordered shortlist + per-stage scores (for the handoff record)
}
```

| Stage | Implementation | Default |
|-------|----------------|---------|
| Retrieve (§7.1) | In-house BM25 over name (split on case/underscore), description, `whenToUse`, `examples`; index built once per registry version | K = 20 |
| Rerank (§7.2) | Interface `Reranker.rerank(instruction, candidates) → ordered subset`; implementations: `none` (truncate retrieval order), `llm` (one call over `whenToUse`/`whenNotToUse` on the secondary-role model, which equals the main model in evaluation per framework-runner §4.4; reported as a `turn` with role `selection`) | `llm` |
| Truncate | Keep top N | N = 6 |
| Complete (§7.3) | Add `requires` after the requiring tool; dedupe | — |
| Override (§7.5) | Planner `tools` → skip retrieve/rerank, still complete | — |

The LLM rerank is selection, not executor work: it does not count against the per-`do` secondary turn cap (executor turns only).

**Tie-break and duplicates.** Equal retrieval scores are ordered by `cost` (lower first), then name. At registration, a tool whose indexed text has BM25 self-normalised cosine similarity > 0.8 with an existing tool logs a warning (never rejects). `category` is not used by selection yet.

> **Decided A-12 (2026-10-23):** BM25 retrieve, shortlist = top 6 + `requires`, and an LLM reranker
> that is implemented and **on by default**, controlled by `rerank: llm|none` (recorded in
> provenance; `none` is the ablation). Its cost is a secondary turn per `do` and appears in
> rollups. A dense/hybrid retriever is deferred until selection recall (orchestrate §10.1) shows
> BM25 is insufficient.

### 4.4 Escalation

`findTools({ need })` runs `select({ instruction: need })` excluding tools already present, adds up
to N tools to the executor's `Tools` map, and returns their declarations so the next branch program
can call them. Logged as a selection miss (`escalation`) in the handoff record. Fallback misses
(orchestrate §10.1) are computed when the record is written, from the step's calls, its shortlist
and the problem's `expectedTools`.

### 4.5 Hot paths

Selection queries an optional `HotPathIndex` (same BM25 index type over snippet descriptions);
matched snippets are included in the executor prompt and their declared tools added before
completion.

> **Decided I-06 (2026-10-23):** Hot paths ship in the first version, with snippets, not just the slot.

**Snippet format.** One file per snippet in `packages/core/src/orchestrate/hot-paths/<id>.ts`,
exporting `{ id, description, tools, outcome, code }`: `description` is what BM25 indexes,
`tools` are added to the shortlist, `outcome` names the anticipated outcome (e.g. `empty-result`,
`nonzero-exit`, `not-found`, `test-failure`), `code` is a branch-language snippet of ≤ 25 lines.

**Seed set (≈ 12).** Cover the S tools' common failure outcomes first, since every problem uses
them: search returns nothing → widen pattern/scope; file not found → locate by name before
failing; edit target string missing or ambiguous → re-read and re-anchor; test run fails →
extract failing test names and first assertion, not the whole log; command non-zero exit →
capture stderr tail and classify; large output → `grep`/`lines` slice instead of reading all;
edit then verify → re-run the narrowest test. Then one per L-tool group where an outcome is
typical (rename with zero references, `moveSymbol` creating a cycle, `check` errors after an edit).

**Sourcing.** Patterns are taken from established agent practice (recovery loops in public coding
agents and harness docs, found by web research) and from failure patterns in our own runs
(viewer failure breakdown). Each snippet must compile through the branch pipeline and is run
against a fake host in a unit test that exercises its anticipated outcome.

**Measurement.** Included snippet ids are recorded (`hotPaths`, orchestrate §8.4). A config switch
`hotPaths: on|off` (default `off`; variant `orchestrate[hotPaths]`) makes them an ablation, so
their effect is measured, not assumed; `compare` runs leave it off (orchestrate §9).

---

## 5. Executor

### 5.1 First request (the handoff)

Stable part first, per-`do` part last (orchestrate §2.1), so the stable prefix is cached across
executors:

- Tools: a single model-facing tool `branch` with a **fixed** description that declares only the
  meta-tools `findTools`, `resolve`, `save`, `refSymbol`. Identical for every executor.
- System: `@aiw/core/prompts/executor.md` (static, hashed).
- User message, in order: instruction with inline-resolved references; handle lines for large
  references; hot-path snippets; turn budget ("You have N turns"); last, the shortlist declarations
  (best fit first, orchestrate §4.2), in the same format as branch declarations, callable from the
  program like any declared tool. Tools added by `findTools` are declared in its result.
- Plain function calling (orchestrate §8.1 alternative) is the same loop with the shortlist exposed
  as individual tools; selected by framework variant `orchestrate[executor=calls]`. Tool definitions
  come first in the request, so this variant's system prompt is not cached across executors — a
  known cost of the variant.

### 5.2 Loop

Uses `@aiw/llm` wrapped by `wrapLlm(reporter)`; each request is a secondary `turn` event and a
transcript entry in session `exec:<doEventId>`. The loop runs until the model returns text without
a tool call (the report) or the budget (secondary turn cap, default 4) is reached. Before the last
allowed turn the engine appends a user message: "This is your last turn: report what you have."
(orchestrate §8.2). Branch programs run through the normal branch runtime with the task's shared
`state`.

### 5.3 Model

Executor model and temperature come from server config (`--executor-model`, default = main model).
In evaluation the runner passes the main model (harness-integration §8); both are recorded per role.

### 5.4 Report finalisation

1. Extract references from the report; resolve each.
2. If any fail and budget remains, send one repair message listing the invalid references; take the
   new report. Otherwise replace each invalid reference with `[invalid ref: …]` (references §6.4).
3. Apply the report size cap (default 2 000 chars of model-written text) with a truncation note.
4. Append framework lines: `Changed:` (from §7), `Budget: exhausted` if applicable, `Saved:`
   (names created/changed in this step with summaries), `Step: sN`.

> **Decided A-14 (2026-10-23, approved):** The repair turn counts against the secondary turn cap, so the cap stays a
> hard fairness bound (framework-runner §4.4). If the cap is already used up, references are
> replaced without a repair turn.

---

## 6. Reference store

### 6.1 Contents

| Entry | Key | Stored |
|-------|-----|--------|
| Step | `sN` | instruction, report, executor model, timestamps |
| Call | `sN.cK` | tool name, args, full (uncapped) result, outcome — from the branch trace of step N, numbered in call order across all programs of the step |
| Named value | `name`, history `name@sN` | value, optional summary, step that wrote it, kind `snapshot` or `live` |
| Live ref | object `{ ref: "path#Sym", version }` stored as a named value | file path, symbol path, content hash at creation |

Named values are the task's branch `state`: `state` is a `Proxy` over the store, so
`state.failingTests = …` and `tools.save({ name, value, summary })` write the same entry
(references §6.2). Writes record the current step for `name@sN` history.

### 6.2 Inline vs handle

At handoff, each reference is rendered: content ≤ 500 tokens (2 000 chars) inline; larger as a
handle line with a summary from references §5.2 (call summaries generated from tool name, args and
outcome; no model call). Transitive references are resolved one level deep (references §5.3).

### 6.3 `resolve`

Accepts either a reference token (`"@s1.c1"`) or a stored live-ref object (references §5.2), plus optional
`grep` (regex, returns matching lines with line numbers) or `lines: [a, b]`. Live code refs read
current content through the host's `readSymbol` implementation if present (otherwise `readFile` of the whole file with a marker that symbol extraction was unavailable, as in S-only runs; whole-file refs use `readFile`) and
compare the content hash; a mismatch returns `stale: true` and the step that changed it (§7).
A deleted target throws `RefNotFound`.

### 6.4 Limits

Per-task size cap (default 20 MB of stored values); on overflow the oldest unnamed call results are
evicted first and resolving them throws `expired` (references §7).

### 6.5 Exposure by framework

> **Decided A-11 (2026-10-23, approved):** `save`, `refSymbol` and `resolve` are framework tools added to orchestrate
> executors only. In `branch-only`, `state` is a plain object without reference tools, matching the
> branching-framework spec ("With no state tools, `state` still works as a plain cache"). Offering
> reference tools in `branch-only` would be a separate variant (`branch-only[refs]`).

---

## 7. Change tracking

Needed for `Changed:` (orchestrate §8.3: "every path written", including writes by `bash`) and for
live-reference staleness (references §3).

- Before each step, walk the workspace root and record `path → (size, mtime, sha1)`; hash only
  files whose size/mtime changed since the last snapshot. Ignore `.git/`, `node_modules/`,
  `__pycache__/`, `.pytest_cache/`, `.venv/` and paths matched by `.gitignore` when present.
- After the step, diff snapshots → added/modified/deleted paths → `Changed:`; also stored on the
  step so staleness can say which step changed a file.

> **Decided A-13 (2026-10-23, approved):** Content-hash snapshots per step. Cost is negligible on problem workspaces;
> for large harness workspaces the walker uses `git status --porcelain` when the root is a git
> repository and falls back to the walk otherwise.

---

## 8. Handoff record and learning data

Attached per `do` via `reporter.attach("orchestrate.handoff", record)` with exactly the fields of
orchestrate §8.4 (`instruction`, `references`, `selection`, `hotPaths`, `budget`, `model`).
Orchestrate §10 metrics (selection recall, expected-tool coverage, precision, rank agreement,
shortlist size, planner vs executor tokens, intents per task, planner `resolve` calls, re-read
tokens, tool-definition tokens, escalation turns) are computed by
`@aiw/report` from events + handoff records — they are orchestrate-specific report sections, not
new comparable metrics (framework-runner §5.4).

Re-read tokens: `@aiw/report` hashes the result of every read-effect inner call per task and sums
the result size of repeats whose file/symbol was not changed in between (from step `Changed` data).

Expected-tool coverage: distinct tool names in a job's `tool` events ∩ the problem's
`expectedTools` in the run's catalog, ÷ the latter. Tool-definition tokens: the declarations sent
per executor request, tokenized with the model's tokenizer (or chars/4 when none is available,
marked as an estimate).
