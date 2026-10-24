# Architecture: Telemetry

**Derived from:** [framework-runner.md §4–5, §7](../features/framework-runner.md)  
**Packages:** `@aiw/telemetry`, `@aiw/llm` (usage normalisation)

---

## 1. Overview

```
framework code ──▶ Reporter ──▶ Sink (JSONL file | no-op)
      │                              ▲
      └──▶ TranscriptWriter ─────────┘ (same sink kind, separate file)
runner: events.jsonl ──▶ buildTree ──▶ rollups ──▶ job.json
```

All comparable metrics are computed from `turn` and `tool` events only (framework-runner §5.4).

---

## 2. Reporter

The feature interface (framework-runner §5.2) with the additions needed to keep nesting correct
across processes and crash-safe:

```ts
interface Reporter {
  readonly scope: string | null;                  // event id this reporter nests under
  turn(e: { model: string; role: Role; usage: Usage; costUsd?: number; latencyMs: number }): string; // returns event id
  tool(e: { id?: string; name: string; args: unknown; ok: boolean; durationMs: number;
            error?: string; harnessId?: string; startTs: number; resultBytes: number }): string;
  toolStart(e: { id: string; name: string; args: unknown; harnessId?: string }): void;
  child(label: string, id?: string): Reporter;    // nested scope; writes a `scope` event
  attach(key: string, data: unknown): void;
  newId(): string;
}
type Role = "main" | "secondary" | "selection";
```

> **Decided A-07 (2026-10-23, approved):** Additions to the feature spec's sketch:
> - **Preallocated ids** (`newId`, `tool({ id })`, `child(label, id)`): a tool's children are
>   written *before* the tool event itself (it is written on completion), so they need the id up
>   front.
> - **`toolStart`**: written when a call begins, so a crash leaves a visible in-flight call.
>   Rollups ignore it.
> - **`role`** on `turn`: main vs secondary counts (framework-runner §4.4) without inferring from
>   nesting; `selection` for an optional LLM reranker.
> - **`harnessId`** and `startTs` on `tool`: correlation fields required by framework-runner §5.3.

Helpers:

- `wrapTools(tools, reporter)`: for each call, `id = newId()`, `toolStart`, call the tool with
  `reporter.child(name, id)` available through an async-local context, then `tool({ id, … })`.
- `wrapLlm(client, reporter, role)`: times the request, normalises usage (§6), writes `turn` and the
  transcript entry (§5); the entry's `turnId` is the `turn` event id (there is no id on the `turn` event pointing back).
- `fromMeta(meta)`: builds a reporter scoped to the parent id carried in MCP `_meta`
  (`aiw/parent`, `aiw/harnessId`) — how the server nests its events under the runner's tool event.

Reporters are passed explicitly; an `AsyncLocalStorage` holds the current scope only so tool
implementations that make nested calls (executor inside `do`) don't need it threaded through.

---

## 3. Event schema

One JSON object per line. Common fields: `v` (schema version), `id`, `parent` (id or null), `ts`
(epoch ms, writer's clock), `kind`.

| `kind` | Fields |
|--------|--------|
| `job` | first line written by the runner: `job`, `attempt`, `framework`, `problem`, `rep` |
| `scope` | `label` |
| `turn` | `model`, `role`, `usage { input, output, cachedRead?, cacheWrite? }`, `costUsd?`, `cacheHit?`, `latencyMs` |
| `toolStart` | `name`, `args`, `harnessId?` |
| `tool` | `name`, `args`, `ok`, `error?`, `durationMs`, `startTs`, `harnessId?`, `resultBytes` |
| `attach` | `key`, `data` (inline if < 64 KB, else `blob: <hash>`) |
| `end` | last line written by the runner: `outcome`, `reason?` |

Missing API fields are omitted, never zero-filled (framework-runner §4.1). Ids are
`<writer>:<n>` where writer is `r` (runner) or `s` (server), e.g. `r:12`, `s:3` — unique within a
job attempt without coordination.

---

## 4. Sinks

- `FileSink(path)`: opens with `O_APPEND`, writes each event as one `write()` of one line, no
  buffering (crash safety, framework-runner §5.3).
- `NoopSink`: default when no path is configured (framework-runner §5.3 "No-op default").
- Server config: `--events <path>` / `AIW_EVENTS`; in harnesses off unless set
  (harness-integration §10).

> **Decided A-06 (2026-10-23, approved):** In a job, runner and server append to the **same** `events.jsonl` (bind
> mount), each with one `write()` per line and namespaced ids. On Linux local filesystems
> `O_APPEND` writes to a regular file are atomic with respect to each other, so lines never
> interleave. Readers tolerate a child appearing before its parent's `tool` line.
> *Fallback if this proves unreliable (e.g. Docker Desktop file sharing):* each writer gets its own
> file (`events.r.jsonl`, `events.s.jsonl`) and the runner merges them by `ts` into `events.jsonl`
> at job end.

---

## 5. Transcripts

`transcript.jsonl` records every model request and response of the job, main and nested
(framework-runner §7). Entry:

```json
{ "v":1, "turnId":"s:14", "session":"exec:r:9", "seq":2,
  "system":"<blob hash>", "tools":"<blob hash>",
  "append":[ /* messages added since this session's previous request */ ],
  "response":{ /* raw provider response body */ } }
```

- `session`: `main`, or `exec:<doEventId>` for orchestrate executors.
- System prompts and tool declarations are written once to `blobs/<sha256>.txt` and referenced by
  hash (framework-runner §7). Writers create blobs with `O_EXCL` so two writers never clobber.

> **Decided A-08 (2026-10-23, approved):** Store each request as a **delta** (`append`) over the previous request in the
> same session instead of the full message array. The full request is reconstructed by
> concatenating `append` arrays in `seq` order, so the record stays verbatim while avoiding
> quadratic growth. If a framework ever rewrites history (it does not today), the writer emits a
> full entry with `reset: true`.

---

## 6. Usage normalisation

`@aiw/llm` exposes `normaliseUsage(apiType, responseBody) → { usage, costUsd?, cacheHit? }`.
One normaliser per API type (framework-runner §4.1 table). `cacheHit` = `cachedRead > 0` when the
provider reports cached tokens, otherwise omitted.

> **Decided A-24 (2026-10-23, approved):** Build only the OpenAI-compatible chat-completions normaliser (incl.
> OpenRouter `usage.cost`) now; the client requests `usage: { include: true }` on OpenRouter.
> Responses / Anthropic / Gemini normalisers are added when an experiment uses them.

---

## 7. Tree and rollups

`buildTree(events)` links events by `parent`; orphans (parent never written, e.g. crash) attach to
the root and are flagged. Rollups (framework-runner §4.5) written to `job.json`:

| Rollup | Definition |
|--------|------------|
| `costUsd` | sum of `turn.costUsd` over the whole tree; `null` if any turn lacks cost |
| `mainTurns` / `secondaryTurns` | count of `turn` by `role` (`selection` counted under secondary) |
| `topLevelToolCalls` | `tool` events whose parent is the root scope |
| `leafToolCalls` | `tool` events with no `tool` descendants |
| `tokens` | sums of usage fields per role |
| `toolTimeMs` / `modelTimeMs` | sums of `durationMs` (top level) and `latencyMs` |
| `callsPerTool` | `tool` events by `name` |
| `externalCalls` | `tool` events whose name is in the `external` group (tools §6.8) |
| `editCalls` | `{ refactor, manual }`: `tool` events of `refactor` group tools vs `edit`/`multiEdit` |

Report-level tools §8 metrics are listed in [data-formats §4](data-formats.md#4-combined-report).
