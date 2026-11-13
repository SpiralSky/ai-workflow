# Feature: Problem Set

**Area:** Evaluation  
**Related:** [framework-runner.md](framework-runner.md), [tools.md](tools.md)

---

## 1. Summary

The problems every framework is evaluated on: what a problem consists of, what makes one good,
how it is validated, and which problems make up the set.

The set has two sizes:

- **Small** — one package of 1–4 files. Cheap; tests basic reasoning and the per-turn overhead of
  each framework.
- **Large** — tasks on a shared, realistic codebase (~30 modules, several thousand lines) that is
  too big to read whole. Tests whether navigation, graph and refactoring tools
  ([tools.md](tools.md) tier L) pay for themselves.

---

## 2. Motivation

The current problems are all small: every file fits in a few reads, so reading everything is
always the cheapest strategy and structure-aware tools cannot show a benefit. Real tasks happen in
codebases where reading everything is not an option. The cost claim
([framework-runner.md §2](framework-runner.md)) has to hold there too.

Budget is tight (framework-runner §6.5), and each problem is multiplied by frameworks × tool
tiers × repetitions. So every problem must earn its place: it should test something no other
problem tests, and it should be able to separate frameworks rather than be passed or failed by all.

---

## 3. Problem folder

Extends the layout in [framework-runner.md §6.1](framework-runner.md):

```
problems/<id>/
  task.md       instruction shown to the model (the only text it sees about the task)
  task.json     metadata (§4)
  Dockerfile    job environment; the workspace is /work
  workspace/    starting files, copied to /work (built from a codebase + overlay for large problems, §6)
  overlay/      large problems only: files added/replaced on top of the codebase (§6)
  checks/       hidden tests + check.sh (exit 0 = pass); never present during the job
  reference/    never present during the job or grading:
    solution.patch   a known-good solution
    notes.md         intended diagnosis, the traps, what an efficient run looks like
```

## 4. `task.json`

| Field | Meaning |
|-------|---------|
| `id` | Folder name. |
| `size` | `small` \| `large` \| `smoke` (setup check only; not in `all`, never reported, §8.2). |
| `set` | `reported` (default) \| `dev` (tuning only; not in `all`, never reported, §8.5). `01-chunk-off-by-one` is `size: "smoke"`, `set: "dev"`. Selectors: `small`/`large` = size AND `set: "reported"`; `dev` = `set: "dev"`; `smoke` = size smoke. |
| `codebase` | Shared codebase id (large problems only, §6). |
| `turnLimit` | Base turn limit (framework-runner §4.4). |
| `tags` | What it tests (`bugfix`, `feature`, `refactor`, `concurrency`, `multi-file`, `rename`, `move`, `signature`, `import-cycle`, `deep-cause`, …). Reports can group by tag. |
| `expectedTools` | Tier-L tools a good run is likely to use. Informational; used to check that L tools are actually exercised (tools.md §8). |

---

## 5. What makes a good problem

1. **The prompt reads like a real request.** One short paragraph, as a user would write it. It
   names the symptom or goal, not the fix.
2. **No hidden constraints.** Everything the checks require must follow from the prompt, the
   visible code or the visible tests. If the checks need `format_price` to stay in `services.py`,
   the prompt or the code must make that a visible requirement (e.g. another module imports it).
3. **Checks test behaviour**, except where structure *is* the task (rename, split, cycle), and then
   they test the structure the prompt asked for, not one particular way to get there.
4. **Checks cannot be passed by shortcuts.** Deleting or weakening visible tests does nothing,
   because grading copies `checks/` over the workspace. Checks re-run the visible tests as well.
5. **Fails before, passes after.** `checks/` fails on the unmodified workspace and passes with
   `reference/solution.patch` applied. Both are verified automatically (§7).
6. **Deterministic and fast.** Standard library only, no network, checks finish in under 30 s.
   Concurrency problems use a check that fails reliably (forced interleaving, many iterations)
   rather than one that fails sometimes.
7. **One idea per problem.** If two problems test the same thing, keep the one that separates
   frameworks better.
8. **No answers in comments, names or git history** of the workspace.

---

## 6. Shared codebases (large problems)

Large problems share a codebase so it is built once and the model meets a realistic project.

```
problems/_codebases/<codebase>/   the clean codebase, with its own passing test suite
problems/<id>/overlay/            files added/replaced to set up this problem (e.g. inject a bug)
```

A build step produces each problem's `workspace/` as codebase + overlay, so a built problem folder
is self-contained, as the runner expects. The codebase's tests must pass before any overlay.

### 6.1 Requirements for a codebase

- **Size:** 25–40 modules in nested packages, 3 000–6 000 lines of source, plus tests. Reading
  every file should cost well over 40k tokens.
- **Real structure:** layered (models → storage → services → API/CLI), a shared event bus,
  config, utilities used across layers; widely used types; some modules much larger than others.
- **Real code:** every module does something and is reachable from tests; no padding or
  generated filler. Code quality is ordinary, not perfect: some duplication, some long functions.
- **Standard library only**, Python 3.12, tests with `unittest`.
- **Not in training data**: written for this set, not taken from a public project.

### 6.2 Codebase: `fulfil`

An order-fulfilment backend for a small online shop.

| Package | Contents |
|---------|----------|
| `fulfil/models/` | `Product`, `Sku`, `Order`, `OrderLine`, `Customer`, `Address`, `Shipment`, `Refund`, `Money` |
| `fulfil/storage/` | In-memory repositories per model, a unit-of-work, JSON serialisers |
| `fulfil/pricing/` | `pricing.py` (one large module: price rules, promotions, tax, rounding) |
| `fulfil/services/` | orders (place, cancel, amend), inventory (reserve, release, restock), shipping (rate, label), invoicing, refunds, notifications |
| `fulfil/events/` | event bus, event types, handler registration |
| `fulfil/cache/` | read-through cache used by the API |
| `fulfil/api/` | request handlers as plain functions, request/response schemas |
| `fulfil/cli/` | admin commands (reports, restock, replay events) |
| `fulfil/reports/` | revenue, stock and refund reports |
| `fulfil/util/` | money formatting, dates, ids, validation |

---

## 7. Validation

A self-check runs for every problem before it enters the set, and whenever the problem or its
codebase changes:

1. Build the workspace; for large problems, the clean codebase's own tests pass.
2. Run checks on the unmodified workspace: must **fail**.
3. Apply `reference/solution.patch`, run checks: must **pass**.
4. Run checks 5× on the solved workspace: must pass every time (determinism).
5. Lint `task.md` for the words of the fix listed in `notes.md` (guards against leaking the answer).

A problem that fails the self-check cannot be selected for a run.

---

## 8. The set

### 8.1 Small problems — kept

| Id | Tests | Turn limit |
|----|-------|-----------|
| `02-inventory-feature` | New behaviour + writing tests | 15 |
| `05-report-refactor` | Behaviour-preserving refactor; knowing when to stop | 20 |
| `07-async-race` | Concurrency; reasoning about interleaving | 20 |
| `08-api-mismatch` | Consumer/provider contract; which side to fix | 15 |
| `09-cache-invalidation` | Multi-file data flow, invalidation semantics | 20 |

Each must be brought up to §5 (in particular §5.2 and §5.5) and the §3 layout. Comments that named
the bug (§5.8) were removed from the `08` and `09` workspaces on 2026-11-13.

### 8.2 Small problems — cut

| Id | Reason |
|----|--------|
| `01-chunk-off-by-one` | Trivial; every framework passes in a few turns, so it only measures fixed overhead. Kept outside the set as a **smoke test** for the setup, never reported. |
| `03-discount-mismatch` | Same idea as 08 (two sides disagree, pick the right one), and 08 is the stronger version. |
| `04-vague-rate-limit` | Tests whether the agent *asks*; there is no user in an eval run, so the outcome cannot be graded fairly. |
| `06-import-cycle` | Two files, and the expected fix depended on a hidden constraint (§5.2). Replaced by `L3-import-cycle`. |

### 8.3 Large problems (codebase `fulfil`)

| Id | Prompt (gist) | What makes it hard | Checks | Tags | Turn limit |
|----|---------------|--------------------|--------|------|-----------|
| `L1-rename-sku` | "Rename `Sku` to `ProductCode` everywhere. The JSON format must not change." | ~60 references in ~15 modules, including attribute names, type hints and imports; the serialised key `"sku"` and stored fixtures must stay as they are, so blind find-and-replace breaks persistence. | `ProductCode` importable from every former location of `Sku`; no identifier `Sku` left in source; round-trip of stored fixtures unchanged; full suite. | `rename`, `multi-file` | 25 |
| `L2-split-pricing` | "`pricing.py` is 900 lines. Split it into a `pricing` package with separate modules for rules, promotions, tax and rounding. Existing imports from `fulfil.pricing` must keep working." | Deciding the split along real dependencies inside the module; moving private helpers with their users; avoiding a new cycle between the submodules. | Required submodules exist and each defines its group's public names; `from fulfil.pricing import X` works for every previous public name; no submodule over 350 lines; no import cycle (AST check); full suite. | `refactor`, `move` | 30 |
| `L3-import-cycle` | "After the last change, `import fulfil.api` fails with a circular import. Fix it without imports inside functions." | Cycle runs through four modules (api → services.orders → events.handlers → reports → api) and the error message names only the last two; fix is moving one shared type/helper into a lower layer. | Every module imports cleanly in a fresh interpreter; no cycle in the import graph (AST check); no function-level imports in changed files; full suite. | `import-cycle`, `move` | 25 |
| `L4-currency-param` | "Invoices and emails always show amounts in USD, even for EUR orders. `format_money` needs to know the currency; pass the order's currency wherever an order is available." | `format_money` has ~25 call sites; most have an order in scope, some (CLI totals across currencies, logs) do not and must keep the default. | Hidden tests render invoice, email and API responses for EUR/GBP orders; cross-currency CLI report unchanged; full suite. | `signature`, `multi-file` | 25 |
| `L5-refund-double-count` | "The monthly revenue report sometimes counts a refund twice." | Symptom is in `reports/`; cause is the refund handler being registered twice when the CLI imports `reports` (import side effect in `events/handlers`). Several calls between symptom and cause; only some entry points trigger it. | Revenue report correct via API and CLI entry points; handler registered once per bus regardless of import order; full suite. | `bugfix`, `deep-cause` | 30 |

Turn limits are first estimates; adjust after the first runs (reference runs should use at most
half of the limit).

### 8.4 Size of a full run

5 small + 5 large = 10 problems. A full comparison is 10 × 3 frameworks × 2 tiers = 60 jobs per
repetition. The catalog-size grid (orchestrate §10.2) is not part of this count. Staged evaluation (framework-runner §6.6) should start with small problems at tier S,
then large at both tiers.

### 8.5 Dev set (temporary)

Frameworks are tuned until they pass the failure gate (framework-runner §6.6). Tuning on the
reported set would overfit the frameworks to the problems they are judged on, so the gate runs on a
separate **dev set** (`set: "dev"`), and the reported set is never gated.

| Id | Notes |
|----|-------|
| `01-chunk-off-by-one` | The smoke test (§8.2). |
| `03-discount-mismatch` | Cut from the reported set as a near-duplicate of 08 (§8.2); fine for tuning. |
| `06-import-cycle` | Fixed to §5.2 on 2026-11-13: a visible test now imports `format_price` from `services`, which the checks require. |
| one large dev problem on `fulfil` | **Deferred** until `fulfil` exists; must not overlap with L1–L5 in what it tests. Until then large-problem behaviour is checked only by pilot runs (framework-runner §6.6). |

Dev problems must meet §5 like any other problem, so that a failure points at the framework, not at
the problem.

Remove this section and the dev problems once the frameworks are mature (they pass the gate without
further tuning).

---

## 9. Open questions

1. **Second codebase.** One codebase means results may reflect its quirks. Add a second
   (different domain, possibly TypeScript) once `fulfil` works.
2. **Who writes the codebase.** It can be written by a model, but then reviewed for padding and
   for being too tidy (§6.1); a codebase that is too regular makes grep-and-read too easy.
3. **Feature task on the large codebase.** All large problems are bug fixes or refactors; an
   end-to-end feature (a new field through model → storage → API → CLI) would add a fifth kind.
   Left out for budget.
4. ~~**Smoke test location.**~~ Decided 2026-10-23: an ordinary problem with `size: "smoke"` (§4).

---

## 10. Out of scope

- How the runner builds images, runs jobs and grades (framework-runner §6).
- The tools available to frameworks ([tools.md](tools.md)).
