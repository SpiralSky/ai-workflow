# Architecture: Experiment Viewer

**Derived from:** [viewer.md](../features/viewer.md)  
**Package:** `@aiw/viewer` (`src/` app, `indexer/`)

---

## 1. Overview

```
experiments/runs/*, experiments/reports/*
        │  aiw view [--watch]   (indexer, Node)
        ▼
packages/viewer/dist/            static bundle (Vite build; built locally, gitignored)
  index.html, app.js
  data/index.js                  run groups, provenance, job outcomes + rollups
  data/jobs/<run>/<job>.js       one per job: events, transcript (reconstructed), artefacts
```

The viewer opens from disk (`file://…/dist/index.html`) and needs no server (viewer §9).

---

## 2. Indexer

- Reads run directories and combined reports, validates them against `@aiw/report` schemas, skips
  (with a warning) anything with an unknown format version — no old formats (viewer §1).
- `index.js`: list of runs (date, models, problem count, status, total cost, provenance), combined
  reports, and per job: outcome, reason, rollups, attempts count.
- Per job file: event tree, transcript sessions reconstructed from deltas
  ([telemetry §5](telemetry.md#5-transcripts)) with blobs resolved, `diff.patch`, `check.log`,
  attachments (`branch.events`, `branch.trace`, `branch.source`, `orchestrate.handoff`,
  `orchestrate.step`), attempts.
- Large tool results are stored once and loaded on expand (chunked into separate files above
  256 KB) so a huge result never blocks the page (viewer §9).
- `--watch`: watches run directories; on append, regenerates the affected job file and `index.js`.

---

## 3. Static data loading

> **Decided A-19 (2026-10-23, approved):** Data files are scripts that call a global registration function
> (`window.__aiw.register("job:<run>/<job>", {...})`) and are loaded by injecting `<script>` tags,
> which works from `file://` (viewer §12 open question). Jobs load on demand. In watch mode the app
> re-injects `index.js` and open job files every 2 s with a cache-busting query and re-renders when
> the content hash changes.

---

## 4. Aggregation

> **Decided A-20 (2026-10-23, approved):** Summary numbers (pass rate, Wilson interval, cost per success, turn and tool
> rollup means, failure breakdown) are computed by `@aiw/report`, bundled into the app. Single runs
> and combined reports use precomputed values; ad-hoc groups are computed in the browser with the
> same code. The viewer defines no metrics of its own (viewer §11). Provenance mismatch in an ad-hoc
> group yields a warning and "not comparable" labels (viewer §4.1).

---

## 5. App structure

React + Vite (viewer §10). Routing is hash-based: `#/g/<group>/f/<framework>/<view>/<job>/<item>`,
where `<item>` addresses a message, tool call or nested session by event id (viewer §4.4).
Compare view (several frameworks): `#/g/<group>/compare/<fw1>,<fw2>,…/<view>/<job>/<item>`.
Ad-hoc group (a set of runs): `#/set/<run1>,<run2>,…/f/<framework>/<view>/<job>/<item>`.
Every view has a stable URL.

```
src/
  app/            layout, sidebar (run groups), framework selector, compare mode
  views/          Summary, JobsMatrix, Job
  conversation/   ConversationView, MessageCard, ToolCallCard, MetricsStrip, Minimap, Search, keyboard
  artefacts/      Outcome, DiffView, CheckLog, Attempts, EventTree
  renderers/      registry.ts, generic/, branch/, orchestrate/
  data/           loader (script injection), store, selectors
  theme/          tokens, light/dark (prefers-color-scheme)
```

- Virtualised message list for long conversations; results collapsed with previews.
- Syntax highlighting: Shiki with TypeScript, Python, diff, JSON grammars, loaded lazily.
- Compare mode: summary table, per-problem matrix, side-by-side job columns (viewer §7).

---

## 6. Renderer registry

```ts
interface Renderer<T = unknown> {
  match: { tool?: string; attach?: string };
  render(item: T, ctx: RenderContext): ReactNode;   // ctx: job data, link builder, nested renderer
}
registerAdaptation(name: string, renderers: Renderer[]): void;
```

- Lookup order: attachment key → tool name → generic. No match → generic (viewer §8.1).
- `ctx.renderConversation(sessionId)` renders a nested session with the full registry, so the
  orchestrate executor's branch calls use the branch renderers unchanged (composition, viewer §8.1).
- Adaptations are code-registered at build time (no runtime plugin loading).

### 6.1 Branch adaptation (viewer §8.2)

Source panel with line numbers; trace panel from `branch.trace`; bidirectional line highlight using
event `line` fields; hot-path marking from `cond` events; error line marking from the `error` event;
expandable loops and full-stream toggle from `branch.events`; inner calls list with a small timeline
from `call` start/duration; state footer table. Card title from the call's `intent` argument (A-26).

### 6.2 Orchestrate adaptation (viewer §8.3)

`do` card: instruction with reference tokens highlighted (resolved values from the handoff record's
`references`); collapsed **Handoff** section built from the executor session's first transcript
entry + `orchestrate.handoff` (never re-derived); selection table; collapsed executor conversation;
report with framework-appended lines (`Changed:`, `Budget:`, `Saved:`) separated and `Noticed:`
marked; parallel `do` calls grouped by shared parent turn; `orchestrate.step` (`changed`, `saved`) feeds
the step line. A `resolve` call shows the reference and the (capped) value returned (viewer §8.3).

---

## 7. Framework names and variants

Framework ids come from `run.json`; `base[k=v,…]` ids are grouped under `base` with the settings
as labels (viewer §4.2). An adaptation is selected by tool names and attachment keys, never by
framework name, so variants and unknown frameworks render automatically.

---

## 8. Read-only guarantee

The indexer writes only to `packages/viewer/dist/data/`; the app has no write path.

---

## 9. Deferred

> **Decided I-07 (2026-10-23):** Per-job annotations (viewer §12) are deferred; if wanted later, store them
> in `experiments/annotations/<run>/<job>.json` (outside run dirs) and add a small local write
> command, since the static viewer cannot write.
