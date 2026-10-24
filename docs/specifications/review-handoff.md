# Spec Review Handoff (2026-10-24)

A review of all feature and architecture specs. Problems that originate in the **feature specs**
need the user's decision and are listed in §1–§4 with a proposed fix. Problems that were purely
architectural have already been amended (§5). Delete an item once it is resolved; delete this file
when it is empty.

---

## 2. Experimental validity (decision needed)

**F4. Failure gate contradicts the problem goal.** framework-runner §6.6 requires every framework
≥ 90% pass rate before scaling up; problems §2 wants problems that *separate* frameworks. Good
problems will trip the gate. Proposal: gate only on smoke + small problems, or only on
setup-looking failures (`patch-failed`, `timeout`, crashes).

**F5. Budget.** framework-runner §6.5 and problems §2 say $0.50 *per run*; CLAUDE.md says $0.50
*total per key* and max $0.10 per run when tight. Also no spec estimates per-job cost: a full rep is
60 jobs (problems §8.4) with up to 30 turns on large problems, which likely exceeds $0.50.
Proposal: align the default with CLAUDE.md and add a cost estimate per job size so staged
evaluation is planned against the real budget.

**F6. Hot paths and reranker only in orchestrate.** Known-good snippets (orchestrate §9) give
orchestrate prompt content the others lack, confounding the comparison. Proposal: `hotPaths` off by
default in comparisons, or a `branch-only[hotPaths]` variant. (The reranker's model was fixed to
the main model in architecture, §5.)

**F7. Statistical power.** Default 1 rep over 10 problems gives very wide Wilson intervals
(framework-runner §6.2). Proposal: state a target rep count (or minimum detectable difference)
before claims are made.

**F8. Provenance table incomplete.** framework-runner §7.1 lacks tool tier (required by tools §3.4)
and framework switches (`rerank`, `hotPaths`, executor interface). Architecture already records them
(runner §9); add them to the feature table.

## 3. Contradictions and gaps in feature specs

**F9. Program form.** branching-framework §3 says the input is "a TypeScript function body"; §4 and
§4.1 say it is an `async` arrow function (no `function` keyword). Fix §3. (Architecture now accepts
only the arrow form.)

**F10. Job outcome reasons.** framework-runner §6.1 lists "timeout" as an infra error (not counted,
retried), while a job wall-clock kill is a framework fail (runner §4.4, needed for uninterruptible
loops). Clarify that §6.1 means *API* timeouts, and add `timeout` and `patch-failed` as fail
reasons.

**F11. Model-side failures unclassified.** Malformed tool-call JSON, empty responses,
context-length overflow (likely for baseline on large problems), content-filter refusals: framework
outcome or infra error? Proposal: malformed args → returned to the model as a tool error; context
overflow → fail with reason `context-limit`; empty/filtered responses → infra, retried.

**F12. Reference grammar.** references §4 does not cover `@name@s2` (§7) or `@s1.c1!` (§9 Q1),
and code-ref paths are inconsistent (`@src/pricing.py#…` vs `@pricing.py#…` in §1, §8). Define
paths as workspace-root-relative and add the history form to §4.

**F13. "Retries" in the turn cap.** orchestrate §8.2 and framework-runner §4.4: "4 = one attempt +
up to 3 retries" misdescribes executor turns (most turns are progress, not retries). Reword as
"at most 4 executor turns".

**F14. No baseline spec.** The control condition appears only in tables. Add a short section (in
framework-runner or tools): prompt, exposure, how a job ends, what the shared base prompt contains.

**F15. Selection recall metric.** orchestrate §10.1 counts "no escalation" as a hit, so a silent
fallback to `bash` looks like success. Add "executor called a generic tool not ranked first" or
overlap with `expectedTools`.

## 4. Hygiene in feature specs and project files

**F16. Decisions not back-propagated.** Still listed as open although decided in architecture:
viewer §12 (A-19, I-07); harness-integration §12 Q2 (I-09), B7 Q1 (I-08); tools §9 Q1 (I-02),
Q2 (I-04); orchestrate §11 Q1 (decided `do`). Struck-through items with leftover text: tools §9 Q3,
problems §9 Q4. Viewer §8.2 assumes a branch `intent` (now A-26).

**F17. Status labels.** features/README lists every spec as Draft; branching-framework says Final;
references says "Draft — under discussion".

**F18. Mentions of the old implementation.** branching-framework "Related: `framework/core/branch/`";
tools §5 "match the current baseline tools, so S results stay comparable with earlier runs"
(conflicts with the no-backward-compat rule).

**F19. Reporter sketch.** framework-runner §5.2's `Reporter` differs from the approved one
(telemetry §2, A-07). Mark it illustrative or update it.

**F20. Outside the specs.** CLAUDE.md's `cd framework && npm test` predates the `packages/` layout
(A-02). Claude's memory note on branch sandboxing (worker threads, `await import()` allowed)
contradicts branching-framework §4.1 / core-branch §2 and will be updated once F1/F3 are decided.

---

## 5. Architecture amendments made (2026-10-24)

Not originating in feature specs, so fixed directly. Two revise previously approved decisions
(marked ⚠).

| Change | Where |
|--------|-------|
| ⚠ API key never enters job containers: an egress proxy holds it and is the only network endpoint orchestrate containers can reach, so tools have no network in any framework (was: `bridge` network + key via `docker exec -e`, an unfair network difference and a key readable by model code) | runner §4.1, §5, §5.1; system-overview A-03, §7 |
| Secrets stripped from tool child environments and from `process.env` where the server holds a key | system-overview §7; tool-catalog §3 |
| ⚠ `branch` calls sharing one `state` are serialized (was: concurrent, relying on the prompt) | core-branch §6; runner A-25 |
| Only the `async` arrow form is accepted, matching branching-framework §4.1 | core-branch §2 |
| Provenance hashes base prompt, executor and reranker prompts, hot-path set; framework switches are part of the framework id | runner §9; data-formats §1.1 |
| LLM reranker uses the secondary-role model (= main model in evaluation) | orchestrate-engine §4 |
| Grading diff and change tracking exclude generated caches | runner §6; orchestrate-engine §7 |
| Invalid-run reason string unified; job identity read from `job.json`, not the directory name | runner §7; data-formats §1 |
| Runner imports `core` only for the base prompt | system-overview §2 |
| Removed mentions of the old implementation, "if not approved" and stale alternatives; status line fixed | core-branch I-01, A-26; system-overview; viewer A-19; framework-server A-22, §7.6 |
