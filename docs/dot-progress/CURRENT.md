# AI Workflow status

Updated: 2026-11-03 15:08 UTC. This is the single current status file; dated notes and Git history retain earlier milestones.

## Running and since when

**RESUMED by 2026-11-03 14:59 UTC:** the user chose cooperative screening with explicit grading-reach and read-audit limits. Cooperative admission and a canary/audit helper are under development; no actor runs have started. The first intended noise experiment is **one fixed task twice, sequentially**, from the same frozen commit/configuration. No new baseline result, native token measurement or cost comparison is claimed.

Shell-safety recovery ran from approximately 14:12 UTC through external verification at 14:28 UTC. Public preparation then completed its tests, independent review and external checkpoint by 14:46 UTC. The temporary stop began at 14:46 UTC and ended after the user's decision. The three-hour checkpoint schedule is re-enabled; a scheduled checkpoint is not proof it has executed.

## Accepted screening limits and remaining gates

- **Cooperative grading accepted for screening:** keep the grader absent during solving. Submitted code may reach grader resources during grading because it runs under the same OS user; the user accepts this stated limitation. Space access is shared, so no isolation guarantee is claimed. Grade only after solving and label results accordingly.
- **Decision resolved:** cooperative screening is permitted; there is no pending decision about waiting for an isolated grading boundary. Do not build a new isolated runner or present limited screening as proof of superiority.
- **Read-audit remains incomplete and must be disclosed.** Available logs do not establish a complete audit of outside-workspace reads. Synthetic canary/audit checks do not prove absence of contamination. Unexpected canary exposure must still mark the affected run contaminated; missing audit evidence is not a clean result.
- **Cooperative admission preparation is unfinished.** A patch and canary/audit helper are being developed for the accepted screening mode. Public-only preflight alone does not grant actor admission. Preserve all other applicable input, safety, grading and evidence requirements; no unreviewed patch is treated as ready.

## User decisions and priority order

Native subagent comparisons are **screening only**, never proof that an idea beats baseline. Candidates qualifying from screening may be listed for later isolated confirmation; do not build that runner now.

Leakage requirements for the accepted cooperative mode: keep graders/reference answers absent during solving, grade afterward with submitted-code reach explicitly disclosed, use unique canaries, mark unexpected exposure contaminated, and inspect available tool logs while stating the incomplete read-audit. No real canary or private grader content belongs in this public status file.

1. **Anti-cheating list:** delivered directly in chat, with prevention and unenforceable limits. Disclosure does not itself satisfy technical gates.
2. **Baseline noise:** first run one fixed task twice, sequentially, from the same frozen commit/configuration and report differences. **Not measured; no actors yet.** Two runs alone are not a reliable variance estimate.
3. **Isolation/equal starts:** verify exact starting commits and separation for each run. Development worktrees are verified; native isolation remains procedural, as accepted for screening, not a security boundary.
4. **One real run:** report elapsed time. **Not measured on the current frozen setup.** Native token usage is unavailable and must remain unknown; mock checks and CI duration do not substitute.
5. **Small fixed comparison only afterward:** freeze tasks, source/configuration and comparison rules. **Not started.** The older 60-cell/300-potential-cell design is not the next dispatch plan.

At three-hour checkpoint reflection, assess observable waste: rework, retries, dead ends, machinery time versus useful outcomes, blocked time and unusable runs. Use rough wall-clock/run counts and the largest observed source, never invented native token or money totals.

## Done, with evidence

Implementation test/review results below were reported by the coordinator; this documentation task did not rerun them. None is an actor comparison or faithful baseline result.

- **Shell safety rebuilt and externally verified:** local replacement `4a6c560`, [remote `88c9d6a7`](https://github.com/SpiralSky/ai-workflow/commit/88c9d6a7ebbbe2cd3fbacfe2754de09a1f4e002d), branch `dot/data-only-actor-persistence-rebuild-20261103`. **132/132 exact-commit tests**, independent review complete. All six changed remote blobs match local bytes; remote tree equals reviewed tree `c9cb3aa2f40e60e0a0c1b22323a7149fda600967`. Includes hostile-character, 98,305-byte boundary, deadline, output-failure and receipt checks. Earlier late-chunk/raw-mode findings were fixed before final verification.
- **Public preparation completed and checkpointed:** [remote `6aa8586c`](https://github.com/SpiralSky/ai-workflow/commit/6aa8586ca525cce08defafe82bc6cdfc7733c692), five public files verified, **140/140 selected tests**, independent review complete, **421 public files checked**. Review narrowed broad Git-status scope to selected public-file hashing. Earlier 51-test results were intermediate; original full admission/grading gates remain unchanged.
- **Bounded private-copy cleanup verified:** coordinator reports **32 target paths across four known repositories checked**, with known private copies absent. This is a bounded inventory, not proof all private material is inaccessible; shared plugin access and unknown copies remain caveats. No private paths or contents are published here.
- **Offline Node/session preparation:** dependency copy was verified byte-for-byte against an existing installation; **11 public session smoke controls passed**. Full registry SRI provenance remains unverified. These controls are not actor runs or baseline outcomes.
- **Offline readiness:** local runtime matches the lock; **8/8 offline checker controls** and **57/57 public harness controls** passed. This is control/runtime evidence only.
- **Private backup verified, not published:** Space version 0 archive SHA-256 `034b849ac81401e4d2ab624a5024cec466c2854beea2b0b1abf59abde05490eb`; ZIP integrity passes. All 26 manifest entries match SHA-256, size and recorded Git blob IDs; one manifest is self-excluded. Static verification is not a secure grading boundary.
- **History preserved:** missing old local `620a421` was not recovered or fabricated; the replacement has a new identity. Original available worktrees were clean at progress `21fcab0`, classifier `b810601`, sign-in/provider `9ed722f` and fixtures `b1190e3`. They are different snapshots, not equal experiment starts.
- **PR guidance delivered:** [#1 migration](https://github.com/SpiralSky/ai-workflow/pull/1), [#2 sign-in](https://github.com/SpiralSky/ai-workflow/pull/2), [#3 DeepSeek](https://github.com/SpiralSky/ai-workflow/pull/3), [#4 classifier](https://github.com/SpiralSky/ai-workflow/pull/4). Coordinator reported no recorded reviews and zero current-head CI statuses today; old CI does not validate current heads. Historical acceptance/native-pilot evidence remains in the [registry](../ideas/experiment-registry.md), not relabeled as today's results.

## Independent work instead

**ACTIVE: preparation for limited cooperative baseline screening.** Finish and validate the cooperative admission patch and canary/audit helper before the sequential one-task/two-run noise check. Continue safe, documented workarounds overnight within existing permissions, avoiding unnecessary blocking decisions. Preserve exact source/configuration, attempts, timing, grader absence during solving, disclosed grading reach, available audit evidence and contamination flags. Do not silently relax other admission/grading requirements, retry canceled actions, bypass denials, build an isolated runner, or treat this as new permission for paid/API work. When a step blocks, preserve it and continue independent authorized work; ask when policy requires authorization. No superiority claim can follow from this screening alone.

## Idea ledger

See the [deduplicated registry](../ideas/experiment-registry.md) for detailed history. No global effectiveness or monetary-savings winner is established.

| Idea family | Recorded implementation/status | Measured scope |
|---|---|---|
| Classifier filtering | Optional implementation; named-model effectiveness deferred. | No current matched quality/recall/task-cost result; native substitutes do not establish named-model quality. |
| Scoped selector reuse | Prototype `3adfa8c`, library-only; not Task/runner exercised. | Historical synthetic six-query replay reduced calls 6→4; not real-task success or savings. |
| Known-good hot paths | Prototype `8dcf05b`; current two-snippet policy parked, branch retained. | Historical bounded pilot: both arms 2/2 tasks and 97/97 checks; snippet payload proxy higher in nine scenarios. Not production-orchestrate evidence or family-wide disproof. |
| Static-context/type interning | Candidate documented; focused tests/survey reported. | Aggregate/native quality evaluation pending; declaration bytes are not measured tokens or dollars. |

Existing rerank-none, lazy tool search, reference passing and BM25 caching are controls/mechanisms, not new measured improvements. **Qualified for later isolated confirmation: none established by this recovery work.**

## Local-only work and checkpoints

- **This ledger:** local `dot/status-ledger-20261103` began at `21fcab0`; remote branch of the same name began at verified public backup `3e3b715`. Ancestry differs intentionally: only this sanitized file is transferred. Each published status milestone has exact-content, branch-head and status-only-diff verification; the containing remote commit identifies this revision.
- **Current cooperative preparation:** admission patch and canary/audit helper remain under development; no completed review or external code checkpoint is claimed for them yet. Their implementation is not published by this status-only update.
- **Safety and public preparation are externally checkpointed** at the links above. Other local branches remain preserved; do not claim backup equivalence without verifying their remote tree. Historical `620a421` remains unavailable.
- **Transport failures retained:** first Git push was denied; one retry after relevant user evidence was permitted but failed for missing CLI credentials. The authorized sanitized safety change was then published through the connector. No successful CLI push or canceled giant-blob retry is claimed.
- **Three-hour schedule: RE-ENABLED**, per coordinator confirmation after the cooperative-screening decision. Resume checkpointing and observable-waste reflection with the active work. Successful execution and environment persistence still require evidence; the schedule alone establishes neither.
- **Publication scope:** status only; no credentials, actual canaries, hidden graders, reference answers or raw run logs. No default/protected-branch edits, PR approvals, merges, force pushes, destructive actions, Codex tasks or paid/model calls occurred in this status work.
