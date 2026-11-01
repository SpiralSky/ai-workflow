---
id: "feature/viewer"
title: "Feature: Experiment Viewer"
status: "review"
author: "mixed"
migration_source_commit: "b2e781f83976e6807f341debea216dcc56a6ff5d"
migration_source_status: "Final (legacy index)"
---
# Feature: Experiment Viewer

**Area:** Evaluation infrastructure  
**Related:** [framework-runner.md](framework-runner.md), [branching-framework.md](branching-framework.md), [orchestrate.md](orchestrate.md), [references.md](references.md)

---

## 1. Summary

The viewer is a read-only browser UI for inspecting experiment output. It answers three questions,
from coarse to fine:

1. **How did the frameworks compare?** Outcomes, cost and turn counts across a group of runs.
2. **What happened in this job?** The conversation, message by message, with tool calls, results,
   diffs and check output.
3. **Why did the framework do that?** Framework-specific detail: a branch program with its
   execution trace, an orchestrate `do` call with the exact handoff the executor received.

It reads the run format defined in [framework-runner.md §7](framework-runner.md) and is built for
that format, not the other way round. Runs in older formats are not supported. Frameworks are not hard-coded: anything that can be named in
a run is viewable, and framework-specific rendering is added as an adaptation over a generic base.

---

## 2. Motivation

Aggregate numbers say *which* framework won but not *why*. Explaining a result means reading the
conversation: where the planner wrote a vague intent, where a branch program took the wrong path,
where an executor was missing a fact the planner had. Today that means reading raw JSONL.

Reading must be fast and pleasant, or it won't be done. The viewer's job is to make the
conversation as easy to read as a well-formatted chat, while keeping every recorded detail one click
away.

---

## 3. Concepts

| Term | Meaning |
|------|---------|
| **Run** | One run directory (`runs/<run-id>/`), framework-runner §7. |
| **Run group** | A set of runs viewed together: a single run, a combined report (framework-runner §6.6), or a user-picked set. The top level of navigation. |
| **Framework** | A named configuration that produced jobs, as recorded in `run.json` (e.g. `baseline`, `branch-only`, `orchestrate`, or a variant such as `orchestrate[secondary=2]`). Not an enum in the viewer. |
| **Job** | One problem × framework × rep (`jobs/<problem>.<framework>.<rep>/`). |
| **Conversation** | The ordered messages of one model session: the main session of a job, or a nested session (e.g. an orchestrate executor). |
| **Renderer** | A component that draws one kind of item (message, tool call, tool result, attachment). Renderers are registered, not hard-coded (§8). |

---

## 4. Navigation

```
┌───────────┬──────────────────────────────────────────────────────────┐
│ Run groups│  [ baseline ] [ branch-only ] [ orchestrate ] [+ compare]│  ← framework selector
│           ├──────────────────────────────────────────────────────────┤
│ ▸ 10-20 b │  Summary · Jobs matrix · Conversation                     │
│ ▸ 10-19   │                                                          │
│ ▸ combined│                                                          │
└───────────┴──────────────────────────────────────────────────────────┘
```

### 4.1 Run groups (left sidebar)

- Lists runs newest first, with date, model(s), problem count, status (`complete` / `invalid` +
  reason / `in progress`) and total cost.
- Combined reports appear as their own groups. A user can also tick several runs and view them as
  an ad-hoc group.
- Grouping runs whose provenance does not match (framework-runner §7.1) is allowed for browsing
  but shows a warning naming the mismatched fields; cross-run aggregates in such a group are
  labelled as not comparable.
- The sidebar collapses to icons for more reading width.

### 4.2 Framework selector (top)

- One tab per framework present in the group, taken from the run data. Unknown framework names are
  shown like any other.
- A tab shows the framework's pass rate and mean cost as a subtitle, so switching is informed.
- Variants of one framework (same base, different settings) are shown grouped under the base name
  with the differing settings as the label, so `orchestrate` and `orchestrate[secondary=2]` sit
  together.
- **Compare** selects two or more frameworks and switches the views below to side by side (§7).

### 4.3 Within a framework

Three views, in order of depth:

1. **Summary** — pass rate, cost, main/secondary turns, top-level/leaf tool calls (framework-runner
   §4.5 rollups), and failure breakdown by reason.
2. **Jobs matrix** — problems × reps, each cell coloured by outcome with cost on hover. Click opens
   the job.
3. **Job** — the conversation (§5) with a side panel for job artefacts (§6).

### 4.4 Deep links

Every view, including a specific message or tool call inside a nested conversation, has a stable
URL (hash-based), so a finding can be shared or written into an issue.

---

## 5. Conversation view

### 5.1 Layout

Messages are shown in order as cards, one per message, in a single readable column (max width
~80 characters of body text), not as raw JSON.

| Item | Rendering |
|------|-----------|
| System prompt | Collapsed by default, with its hash (framework-runner §7.1). Expanding shows it in full. |
| User / task prompt | Full width, markdown rendered. |
| Assistant text | Markdown rendered; code blocks syntax highlighted. |
| Thinking / reasoning | Collapsed by default, muted style. |
| Tool call | Card with tool name, compact args summary on one line; expands to full args. Uses the renderer registered for that tool (§8). |
| Tool result | Attached under its call, not as a separate message. Collapsed to a preview (first lines + size) when long; errors are always expanded and marked. |

Each assistant turn shows a quiet metrics strip: model, input/output/cached tokens, cost, latency.
Turns on a different model from the main session (secondary models) are visibly marked.

### 5.2 Reading aids

- **Outline / minimap** beside the conversation: one tick per turn, coloured by kind (text, tool
  call, error), with tick size proportional to tokens, so expensive or failing turns are found
  at a glance.
- **Expand / collapse all** for tool results and nested conversations.
- **Search** within the job, across all messages, args and results, including nested sessions.
- **Keyboard navigation**: next/previous turn, next error, expand/collapse current item.
- **Raw toggle** on any item shows the underlying event/transcript JSON.
- **Copy** buttons on code, args and results.

### 5.3 Look

The aim is a clean, calm reading surface: generous spacing, a single readable typeface plus a
monospace for code, restrained colour used only to carry meaning (role, outcome, error, model
tier). Light and dark themes, following the system setting by default.

---

## 6. Job artefacts

A side panel (or tabs beside the conversation) shows the rest of the job directory:

- **Outcome** — pass/fail, failure reason, attempts and cost of all attempts.
- **Diff** — `diff.patch`, rendered as a file-by-file diff with syntax highlighting.
- **Check log** — `check.log`, with failing tests highlighted.
- **Attempts** — earlier attempts (`attempts/<n>/`) can be opened as conversations too, marked as
  superseded.
- **Event tree** — the reporter's event tree (framework-runner §4.5) as an expandable tree with
  per-node cost and duration; selecting a node scrolls the conversation to it.

---

## 7. Comparison

With two or more frameworks selected:

- **Summary** becomes a table, one column per framework, best value in each row highlighted.
- **Jobs matrix** shows one cell per framework per problem, so a problem that only one framework
  solved stands out.
- **Job** shows the conversations for the same problem and rep side by side, scrolling
  independently. Per-conversation totals are pinned at the top of each column.

---

## 8. Renderers and framework adaptations

### 8.1 Base and adaptations

The viewer has a generic base that renders any conversation: messages, tool calls with JSON args,
text results. A framework adds an **adaptation**: a set of renderers registered for the items it
produces, identified by tool name and/or attachment key (framework-runner §5.4 `attach`).

- An item with no registered renderer falls back to the generic one, so a new framework is
  viewable on day one and can be made pleasant later.
- Adaptations compose: orchestrate's executor uses the branch interface (orchestrate §8.1), so its
  nested conversation reuses the branch renderers unchanged.
- Adaptations only add rendering. They never compute metrics (framework-runner §5.4).

### 8.2 Branch

For a branch tool call:

- The program is shown as TypeScript with **syntax highlighting and line numbers**; `intent` (an optional
  `branch` field, architecture/core-branch A-26) is shown as the card title; without one, the
  program's first comment line is used.
- The **execution trace** (branching-framework §7) is shown beside or below the program. Hovering
  or selecting a trace line highlights the source line it refers to, and vice versa.
- The **hot path** (taken `cond` events) is marked on the source: taken branches emphasised, untaken
  ones dimmed.
- **Errors** are marked on the throwing line with the mapped stack.
- Collapsed **loops** can be expanded into per-iteration events.
- By default the trace shown is the one the model saw (truncated, branching-framework §7.4); a
  toggle switches to the full, untruncated event stream kept in the run output.
- Inner tool calls are listed with args, results and durations; concurrent calls are shown on a
  small timeline.
- The state footer (branching-framework §4.4) is shown as a compact table.

### 8.3 Orchestrate

For a `do` call:

- The card shows the planner's `instruction` as written, with **references** (`@s2`,
  `@failingTests`, `@src/pricing.py#apply_discount`) highlighted; hovering one shows its resolved
  value.
- **Handoff** — a section, **collapsed by default**, showing exactly what the executor received
  (orchestrate §4.2): the instruction with references resolved, the system prompt, the shortlist as
  rendered declarations, hot-path snippets, and the turn budget. It is read from recorded data,
  never re-derived: the executor's first request in the transcript (framework-runner §7) plus the
  handoff record (orchestrate §8.4), so it matches what was sent.
- **Selection** — inside the handoff: the shortlist with retrieval/rerank scores and any explicit
  `tools` override or escalation (orchestrate §7), from the attached selection data.
- **Executor conversation** — the nested session, collapsed by default to a one-line summary
  (turns, tool calls, cost, budget exhausted or not), expandable in place using the conversation
  view (§5) and branch renderers.
- **Report** — the result returned to the planner, with the framework-appended lines (`Changed`,
  `Budget`, `Saved`; orchestrate §8.3) visually separated from the model-written part and the
  `Noticed:` line marked.
- Parallel `do` calls in one planner turn are shown side by side or as a group.
- A `resolve` call shows the reference and the (capped) value returned.

### 8.4 Future frameworks

A new framework provides at minimum: its display name and any variant settings to label (§4.2),
and optionally renderers. Harness subagents (framework-runner §5.5) have the same shape as
orchestrate's nested calls and reuse the nested-conversation renderer.

---

## 9. Data and scale

- The viewer is static: it needs no running server to browse. A build step indexes run directories
  into what the browser loads.
- Run groups and summaries load up front; job conversations load **on demand** when opened, so
  many runs don't make the first load slow.
- Long conversations and large results are virtualised or lazily expanded; a single huge tool
  result must not freeze the page.
- **Watch mode**: while a run is in progress, the viewer refreshes as events are appended. Jobs
  that crashed show everything recorded up to the crash (framework-runner §5.3), marked as
  incomplete.
- The viewer is read-only. It never writes into run directories.

---

## 10. Implementation notes (non-binding)

- A component framework (React suggested) fits the base-plus-adaptations model (§8): base
  components for message, tool call and result; framework adaptations as registered components.
- The output is a static bundle opened from disk; a build step (e.g. Vite) is acceptable as long
  as viewing needs no server.
- Syntax highlighting with a maintained highlighter that supports TypeScript, Python, diffs and
  JSON (e.g. Shiki or Prism).

---

## 11. Out of scope

- Editing, annotating or re-running jobs from the viewer.
- Computing metrics not defined by the runner (framework-runner §5.4).
- Hosting or sharing over the network; the viewer is local.

---

## 12. Open questions

- ~~**Static loading.**~~ Decided 2026-10-23: data files are scripts loaded by injected `<script>` tags, one per job, loaded on demand (architecture/viewer A-19).
- ~~**Annotations.**~~ Decided 2026-10-23: deferred; if wanted later, stored outside run directories (architecture/viewer I-07).
