# Feature: Orchestrate

**Area:** Core agent interface  
**Related:** [branching-framework.md](branching-framework.md), [framework-runner.md](framework-runner.md), [known-good-hot-paths](../../ideas/known-good-hot-paths.md)

---

## 1. Summary

Orchestrate splits an agent into two tiers that answer different questions:

- The **planner** (main session) decides *what needs to happen next*. It works only in
  **intents**: short natural-language descriptions of one step of the task.
- The **executor** (secondary session, one per intent) decides *how to do it*. It is given a
  small set of tools chosen for that intent, carries out the step, and returns a report.

Between the two sits **tool selection**: given an intent, find the minimal set of tools from a
potentially very large catalog that is sufficient to carry it out.

The planner never sees tool schemas, raw tool output, or file contents unless an executor puts
them in its report.

---

## 2. Motivation

Three costs grow with the number of tools and the length of a task:

1. **Tool-schema bloat.** Every tool exposed to a model costs prompt tokens on every turn, and
   accuracy of tool choice drops as the list grows. A catalog of hundreds of tools (MCP servers,
   project scripts, harness tools) cannot be exposed directly.
2. **Context pollution.** Raw tool output (file contents, grep hits, test logs) accumulates in the
   main context although only a small conclusion from each is needed for later decisions.
3. **Mixed concerns.** A single model must both plan the task and get every call's arguments
   right. Errors in the second derail the first.

Orchestrate addresses all three: tool schemas are only shown to an executor and only for the
selected tools; raw output stays in the executor and is discarded after its report; planning and
execution are separate prompts that can use separate models.

The goal is to lower the **tokens and intelligence needed per action**. The catalog is meant to grow
as large as needed: every discrete action (a refactor, a symbol lookup, a test run) gets a tool designed
for it, and actions that always occur together are merged into one tool (§6.1). Repeated actions then
need tool choice, not reasoning: a kind of muscle memory without retraining the model. Future tools may
pair small models with deterministic algorithms to reduce the intelligence required further.
This only pays off if cost per turn stays flat as the catalog grows, which is what selection (§7)
must deliver.

### 2.1 Relation to prior art

Similar ideas exist. This design was developed independently of them:

- **Subagent delegation** (e.g. Anthropic's multi-agent research system, Claude Code subagents): a
  lead agent with its own tools spawns workers that also choose their own tools. The gain comes
  from spending more tokens in parallel, in separate contexts, on independent subtasks. Orchestrate
  uses executors too, but its aim is a cheaper action, not parallel breadth. The planner has no tools.
- **On-demand tool loading** (e.g. Anthropic's Tool Search Tool with deferred tools): the
  *executing model* searches the catalog and loads definitions as it goes. Every search is a model
  turn: output tokens plus a re-read of the whole context. In a long-lived session, loaded
  definitions stay in the history and are re-read (as cache reads) on every later turn.

Orchestrate moves the first selection out of the model. Retrieval (§7.1) costs no model tokens, the
optional rerank (§7.2) is one cheap call over a fixed *K*, and the executor sees a shortlist of
roughly constant size whatever the catalog size. When that first pass misses, `findTools` (§7.4)
is the same mechanism as a tool search. So **the worst case is tool search**, and every
first-pass hit is cheaper. The claim fails if first-pass recall drops as the catalog grows,
because each miss then adds an escalation turn. §10.2 tests this.

Caching: a shortlist is a fresh prompt suffix, so its definitions are usually uncached input. Order
the executor prompt as stable instructions first, shortlist last, so the stable part stays cached.
Canonical tool ordering is not used: §7.2 orders by fit, and tools that are always used together
should be merged rather than cached as a pair.

---

## 3. Concepts

| Term | Meaning |
|------|---------|
| **Intent** | One step of the task, stated as an outcome: "find where the discount is applied to the order total". The planner's only action. |
| **Planner** | The main-session model. Emits intents, reads reports, decides the next intent or finishes. |
| **Executor** | A short-lived model session that receives one intent plus a tool shortlist and carries it out. |
| **Catalog** | All tools registered with orchestrate, each with selection metadata (§6). |
| **Shortlist** | The tools selected for one intent (§7). |
| **Report** | The executor's natural-language result, the only thing returned to the planner (§8.3). |

### 3.1 What an intent is (and is not)

An intent ends where the planner needs to **make a judgment** about the result before deciding
what to do next. Steps that need no judgment in between belong in one intent.

A specific, checkable hypothesis lets the planner make the judgment in advance: "if X, do Y;
otherwise report what you found". Use such a **conditional intent** when confirmation leads to
one obvious action. Split into separate intents when the result could lead to several different
next steps: no hypothesis yet, several candidate fixes, or a risky change the planner wants to
review first. Splitting the reading and editing of the same code across intents makes the second
executor read it again (§11.3).

Example — fixing a failing test in an unfamiliar repo:

| # | Intent | Why it is its own step |
|---|--------|------------------------|
| 1 | Run the test suite; report which tests fail, their error messages, and any pattern across them. Save the failing tests as `failingTests`. | The planner must read the failures to pick what to investigate. |
| 2 | All of `@failingTests` expect 90.00 and get 91.80, so tax is probably applied before the discount. Find the function that calls both `apply_discount` and `apply_tax` and check the order. If tax comes first, swap them and rerun `@failingTests`; otherwise make no edits and report the order you found. | Specific hypothesis with a check: confirm and fix in one step, so the executor that reads the code also edits it. The planner's next judgment is on the test result. |
| 3 | Run the full test suite and report any failures. | Confirms nothing regressed; the planner decides whether to finish. |

If step 1 had shown no pattern, step 2 would be "find the code that computes the asserted value
and explain how it is computed", and the fix would be a separate step decided by the planner.

Counter-examples:

- Too fine: "read `pricing.py`" — this is *how*, not *what*; the planner would then need the file
  contents in its context, defeating the purpose.
- Too coarse: "fix the bug" — the executor has to both plan and execute, and the planner learns
  nothing it can verify. A conditional intent is not this: it names the hypothesis, the check,
  the action and the success test.

---

## 4. User-visible behaviour

### 4.1 Planner

By default the planner has two tools: `do` (see §11) and a capped, read-only `resolve` (below).

`do`:

| Field | Required | Meaning |
|-------|----------|---------|
| `instruction` | yes | The step, in natural language. Includes any facts from earlier reports the executor needs (paths, error text, the decided fix), any limits ("only touch `pricing.py`"), and what to report back. |
| `tools` | no | Explicit tool names, bypassing selection (§7.5). |

Returns the report (§8.3).

The executor starts with no knowledge of the task beyond `instruction`. Facts are only needed in `instruction`
when they came from an earlier step *and* cannot be cheaply rediscovered: a decided fix,
an error message, the one file out of hundreds that matters. Step 2 in §3.1 is the typical case.

Short decided facts (the hypothesis, the fix, a line number) are written directly in
`instruction`; the planner has already read them and restating costs a few tokens. Content that
is large or must be exact — code, test results, logs — is passed as a **reference** instead: to
earlier steps (`@s2`), values an executor saved (`@failingTests`), or code
(`@src/pricing.py#apply_discount`). The framework resolves them for the executor. See
[references.md](references.md). Referencing a whole step report (`@s2`) just to pass on its
conclusion is discouraged: it also passes on any guesses in that report.

`resolve` lets the planner read a referenced value itself when a report's summary or footer is
not enough (e.g. the exact names in `@failingTests`). It has the same interface as the
executor's `resolve` ([references.md §5.2](references.md)), but each result is capped (default
~1k tokens; larger results are truncated with a note). Use it to look things up, not to read code;
reading belongs in a `do`. How often the planner calls `resolve` is recorded (§10.1).

Whether other tools are exposed to the planner alongside `do` and `resolve` is operator configuration and
outside this spec.

### 4.2 Executor

The executor receives:

- `instruction`,
- the framework meta-tools `findTools`, `resolve`, `save`, `refSymbol` (always present, not selected),
- the shortlist (§7), best-fit first, rendered as branch declarations by default (§8.1),
- relevant hot-path snippets if any are registered (§9),
- a turn budget.

It does not see the planner's conversation or other executors' work.

---

## 5. Lifecycle of one intent

```
planner ──intent──▶ selection ──shortlist──▶ executor ⟲ (tools)
   ▲                                              │
   └──────────────────── report ◀─────────────────┘
```

1. Planner emits an intent.
2. Selection builds a shortlist from the catalog (§7).
3. Executor runs until it reports, or exhausts its turn budget.
4. The report is returned to the planner as the `do` tool result.
5. The executor session is discarded.

Executors run sequentially by default. Parallel intents (several `do` calls in one planner
turn) are allowed only when every shortlist in the batch contains only `read` tools (§6, `effect`).

---

## 6. Tool metadata

Every catalog tool carries the branch registration fields
([branching-framework.md §6.2](branching-framework.md)) plus selection metadata:

| Field | Required | Meaning |
|-------|----------|---------|
| `whenToUse` | yes | Situations this tool is the right choice, written as intents would be phrased ("find where a symbol is defined"). Indexed for retrieval. |
| `whenNotToUse` | no | Common confusions ("not for searching file *names* — use `findFiles`"). Shown to the reranker and executor, not indexed. |
| `examples` | no | Example intents this tool served. Indexed. Automatic filling from successful runs (§10) is future. |
| `category` | no | Coarse group (`fs`, `search`, `vcs`, `test`, `web`, …). Reserved for shortlist diversity and fallbacks (future; not used in selection yet). |
| `effect` | yes | `read` \| `exec` \| `write` \| `external`. `exec` runs workspace code without editing files (tests, snippets); `external` has side effects outside the workspace. Only `read` counts as read-only for parallelism (§5) and read-only mode (harness-integration §7.4). |
| `requires` | no | Tools that must accompany this one (e.g. `edit` requires `readFile`). Pulled in after selection. |
| `cost` | no | Rough relative cost/latency; breaks exact score ties in selection ([engine §4](../architecture/orchestrate-engine.md)). |

Harness tools adapted per [branching-framework.md §6.3](branching-framework.md) have no
`whenToUse`; it is derived from the description until a curated one is supplied.

### 6.1 No near-duplicates

The catalog must not contain tools that do the same job. Overlapping tools (several `search` tools
from different MCP servers, `findFiles` and a second glob tool) split retrieval scores and crowd each other
out of the shortlist. Instead, merge them into one tool with arguments that select the variant
(`search({ query, source? })`), with defaults that cover the common case so the executor rarely
needs to set them.

Registration warns (no rejection) when two tools' indexed text is highly similar ([engine §4](../architecture/orchestrate-engine.md)). Adapted harness tools that
overlap are the operator's to merge or hide.

---

## 7. Tool selection

Selection is a pipeline. Each stage narrows the set; only the first is mandatory.

### 7.1 Retrieve (high recall)

Score every catalog tool against `instruction` over its indexed text
(name, description, `whenToUse`, `examples`). BM25, dense vectors, or a hybrid of both are all
acceptable; the stage is pluggable. Keep the top *K* (default 20).

Goal: the needed tools are almost always in the top *K*. Precision does not matter yet.

### 7.2 Rerank / classify (precision and order)

Optionally reduce the *K* candidates to the minimal sufficient set using a stronger judge:
a cross-encoder, a small classifier trained on logged runs (§10), or a cheap LLM call that sees
`whenToUse`/`whenNotToUse`. Target size: a handful (default ≤ 6). The default judge is the
TypeSafe Jev decision model (framework-runner §4.1); its calls count toward the run budget.

The output is **ordered by fit for this intent**, not by retrieval score: the tool that should be
tried first comes first. A specific tool (`findSymbol`) ranks above a general one that could also
do the job (`bash` + `grep`), so the executor is steered away from falling back on generic tools.
A general tool is only included when nothing more specific fits.

### 7.3 Complete

- Add `requires` dependencies, placed after the tool that required them.

There is no always-included tool set apart from the framework meta-tools (`findTools`, `resolve`, `save`, `refSymbol`, §4.2): a tool reaches the executor only through selection,
the planner's `tools` override, or escalation (§7.4).

### 7.4 Escalate (recovering from misses)

The executor has a meta-tool `findTools({ need })` that runs selection again with its own query
and adds the results to its tool set for the rest of the intent. If it still cannot proceed, it
says so in its report. Every escalation is logged as a selection miss.

### 7.5 Override

If the planner passes `tools`, stages 7.1–7.2 are skipped; 7.3 still applies.

---

## 8. Execution

### 8.1 Interface

The executor uses the **branch** interface by default: the shortlist is exposed as the `Tools` map
of a branch program, so the executor can chain several tools in one turn.
Plain function calling is an alternative executor interface, kept for comparison. Branch remains
the default unless experiments show plain calling performs better on the same shortlist.

With a small, well-chosen shortlist, many intents need only one or two tool calls; branch adds
no cost in that case, since a branch program with one call is just a call.

### 8.2 Budget

Each `do` call has a turn budget: the secondary turn cap (framework-runner §4.4), default 4 (at most 4
executor turns; one is the normal case). It is configurable; 2–3 is worth testing. On its last turn the executor is told
to report what it has, rather than being cut off without a report.

### 8.3 Report

The report is **natural language** written by the executor: the answer to `instruction`, including
negative results ("`config.yaml` does not exist; the closest match is `config.example.yaml`").
A "not found" or "could not do X because Y" is a valid, useful answer — the planner decides
what it means.

A report may end with an optional **Noticed:** line: things the executor saw that are outside
`instruction` but may matter later ("`apply_tax` rounds each line to cents before summing").
It is a sentence or two, not a log; anything larger is saved and referenced (`@roundingNote`).
Without it, such observations are lost when the executor is discarded and a later step has to
rediscover them.

The framework appends these lines, which the model cannot get wrong or omit, taken from the trace:

- **Changed:** every path written, or `none`.
- **Budget:** `exhausted` if the turn budget ran out (omitted otherwise).
- **Saved:** named references created or changed in this step ([references.md §6.2](references.md)).
- **Step:** the step id (`Step: sN`), so the planner can reference it.

Reports have a size cap; raw tool output must be summarised, not pasted.

### 8.4 Handoff record

The executor's requests are recorded verbatim in the job transcript
([framework-runner.md §7](framework-runner.md)); its first request is the exact handoff (system
prompt, instruction with references resolved, rendered shortlist). Facts that cannot be recovered
from that text are attached per `do` call as a **handoff record**
([framework-runner.md §5.4](framework-runner.md)):

| Field | Content |
|-------|---------|
| `instruction` | The instruction as the planner wrote it, references unresolved. |
| `references` | Each reference in the instruction: how it was resolved (inline or handle, [references.md §5](references.md)), the text the executor received, and the step it came from for snapshots. |
| `selection` | The shortlist with scores and order per stage, any explicit `tools` override, escalations (§7), and selection misses (§10.1: kind `escalation` or `fallback`, with the tool involved). |
| `hotPaths` | Ids of hot-path snippets included (§9). |
| `budget` | Turn budget given and turns used; whether it was exhausted (§8.2). |
| `model` | The executor's model. |

The record is for inspection only (framework-runner §5.4); §10 reads from it.

---

## 9. Hot paths

Selection may also retrieve [known-good hot paths](../../ideas/known-good-hot-paths.md) — short
branch snippets for common intent patterns — and include them in the executor prompt. Snippets
are indexed like tools and can declare the tools they use, which are then added to the shortlist.
The first version ships a seed set of snippets and an on/off switch so their effect is measured
([orchestrate-engine §4.5](../architecture/orchestrate-engine.md#45-hot-paths)).

- **Generic only.** Snippets encode general patterns (e.g. "run tests, read the first failure,
  fix, rerun"), never knowledge of a specific problem (framework-runner §6.6 overfitting rule).
- **Off by default.** Snippets are prompt content the other modes lack, so the cross-mode
  comparison (baseline vs. branch-only vs. orchestrate) runs without them. Their effect is
  measured separately as the ablation `orchestrate[hotPaths]` vs. `orchestrate`.

---

## 10. Learning from runs

Every intent produces a log record: the handoff record (§8.4), tools actually called and in what
order, and whether the overall task succeeded.

This data is used to:

- add successful intents as `examples` on the tools they used (future),
- train or calibrate the §7.2 classifier,
- measure selection quality (§10.1).

### 10.0 Fine-tuned models (future)

The same logs are training data for small local models fine-tuned for one role: a §7.2 reranker,
an executor that needs no tool-use instructions in its prompt, or a planner that only emits intents.
Fine-tuning cuts prompt size and per-call cost but is expensive to set up; it is not part of the
first implementation.

### 10.1 Metrics

Reported per run in addition to [framework-runner.md](framework-runner.md) metrics:

- **Selection recall:** fraction of intents with no selection miss. A miss is either an
  **escalation** (the executor called `findTools`) or a **fallback** (the executor called `bash`
  while a tool from the problem's `expectedTools` (problems §4) that is in the run's catalog was
  not shortlisted). Fallback is a heuristic flag, so recall is approximate; flagged steps are
  listed in the viewer for audit.
- **Expected-tool coverage:** per job, the fraction of the problem's `expectedTools` in the
  catalog that were called at all (also reported for baseline and branch).
- **Selection precision:** tools called ÷ tools shortlisted.
- **Rank agreement:** whether the executor's first-called tool was the top-ranked one.
- **Shortlist size** (mean, p95).
- **Planner vs executor tokens**, to show where the cost goes.
- **Intents per task.**
- **Planner `resolve` calls per task**, and tokens returned by them.
- **Re-read tokens:** content returned again for an unchanged file or symbol within one task (§11.3).
- **Tool-definition tokens** per task (tokenized declarations; the API reports cache use per
  request, not per prompt part, so no cached/uncached split).
- **Escalation turns** (`findTools` calls) per task. Their output tokens are not reported: a turn
  that calls `findTools` usually does other work too.

### 10.2 Catalog-size scaling experiment

Tests the §2.1 claim that orchestrate's cost per task stays flat as the catalog grows, while
model-driven tool search does not.

- **Baseline `branch-only[toolSearch]`:** one session with the branch tool, the stable prompt and
  a `findTools` meta-tool, but no other tools up front. Tools that `findTools` finds join its `Tools`
  map and stay there for the rest of the session. `findTools` uses the same retrieval stage (§7.1)
  as orchestrate, without rerank, so the comparison isolates *who selects* (framework vs. executing model).
- **Catalog padding:** the variant key `catalog=N` pads the real catalog with distractor tools up
  to N tools. Distractors are plausible but unneeded for the problem set, and they still obey §6.1 (no
  near-duplicates of real tools). They are generated once and fixed, so runs stay comparable.
- **Grid:** `orchestrate[catalog=N]` vs. `branch-only[toolSearch,catalog=N]` for N = 50, 200, 1000,
  on the same problems.
- **Report per N:** pass rate, cost per successful job, selection recall (first pass), escalation
  turns, tool-definition tokens (cached/uncached), and output tokens spent on searching.

The claim holds if orchestrate's selection recall and cost per successful job stay roughly flat in N,
and tool search's cost grows faster at a similar pass rate.

---

## 11. Open questions

1. ~~**Name.**~~ Decided: `do` (field `instruction`), unless an A/B run shows `intent` performs
   better on the same problems. Tool names and descriptions measurably change model tool-use
   behaviour (Faghih et al., *Tool Preferences in Agentic LLMs are Unreliable*, EMNLP 2025), so
   the name is a variable, not cosmetics. `delegate` was rejected: it suggests handing off the
   whole task.
2. **Lazy planning.** Intents that are too coarse ("fix the bug") push planning into the executor.
   Track intents-per-task and the share of single-intent tasks.
3. **Executor persistence.** Executors start cold. Most re-reading comes from splitting the
   reading and editing of the same code across intents, which conditional intents (§3.1) avoid.
   Lost observations are covered by the report's **Noticed:** line and saved values (§8.3).
   References and structure-aware tools ([references.md §8](references.md)) keep the rest cheap.
   Measure the remaining overhead (re-read tokens: content returned again for an unchanged
   file or symbol within one task) before adding a "continue previous executor" option. Tool-side state (shell cwd,
   browser session, running processes) is separate and may persist across executors regardless.

---

## 12. Out of scope

- The branch tool itself ([branching-framework.md](branching-framework.md)).
- Specific retrieval or reranker implementations; this spec defines the stages and their contracts.
- Planner prompt wording.
