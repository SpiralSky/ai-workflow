---
id: 2026-11-02-test-resource-isolation
title: "Explicit resource-isolated local test scheduling"
status: draft
specs: ["architecture/system-overview","architecture/tool-catalog"]
---

# Explicit resource-isolated local test scheduling

## Goal

Expose explicit test-file scheduling for resource-constrained local preflight without changing product behavior, test assertions, discovery, or acceptance criteria. Experimental development is authorized on an isolated branch; this plan remains draft.

## Scope

- Validate optional `AIW_TEST_CONCURRENCY` before setup or child execution.
- Pass the actual Node `--test-concurrency=N` argument to every existing test child; unset retains Node defaults.
- Document serial local acceptance (`1`), preserve fail-fast/zero-skip checks and final typecheck, and test the orchestration with fake children.

## Non-goals

Product/runtime changes, timeout increases, fixture/grading changes, test selection changes, provider/model calls, Docker execution, performance claims, approval or merge.

## Specs implemented

| Spec | Coverage |
|------|----------|
| architecture/system-overview §5 | Existing Node test/tsx execution; no runtime-language changes |
| architecture/tool-catalog §4, A-35 | Preserve timeout/partial-output contract and original tool tests unchanged |

## Acceptance criteria

- [ ] Explicit `1` reaches every test child as `--test-concurrency=1` before test paths.
- [ ] Invalid configuration fails before any child execution; unset preserves defaults.
- [ ] All discovered test files, including native/relocated probes, remain scheduled; typecheck follows only successful zero-skip suites.
- [ ] Skips, nonzero exits, signals, spawn errors and invalid summaries still stop the run.
- [ ] Full prepared-worktree acceptance is run under the same serial scheduling for baseline and candidates, without redefining product improvement.

Focused evidence belongs in HANDOFF.md and docs/dot-progress; unchecked boxes do not invent approval.

## Risks

1. Serial file scheduling reduces contention but does not guarantee wall-clock timing on an overloaded host.
2. Serial acceptance is not proof of parallel stress performance; any comparison must disclose and match scheduling.
3. Fake orchestration tests are not package/native execution or full-suite acceptance.

## Steps

1. `test-scheduling`: implement and locally test the explicit option, record original failure and limitations, and hand off for review and full unchanged-suite validation.
