# Spec Review Handoff (2026-10-24)

A review of all feature and architecture specs. Problems that originate in the **feature specs**
need the user's decision and are listed in §1–§4 with a proposed fix. Problems that were purely
architectural have already been amended (§5). Delete an item once it is resolved; delete this file
when it is empty.

---

## 3. Contradictions and gaps in feature specs

**F12. Reference grammar.** references §4 does not cover `@name@s2` (§7) or `@s1.c1!` (§9 Q1),
and code-ref paths are inconsistent (`@src/pricing.py#…` vs `@pricing.py#…` in §1, §8). Define
paths as workspace-root-relative and add the history form to §4.

**F14. No baseline spec.** The control condition appears only in tables. Add a short section (in
framework-runner or tools): prompt, exposure, how a job ends, what the shared base prompt contains.

**F15. Selection recall metric.** orchestrate §10.1 counts "no escalation" as a hit, so a silent
fallback to `bash` looks like success. Add "executor called a generic tool not ranked first" or
overlap with `expectedTools`.

## 4. Hygiene in feature specs and project files

**F17. Status labels.** features/README lists every spec as Draft; branching-framework says Final;
references says "Draft — under discussion".

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
