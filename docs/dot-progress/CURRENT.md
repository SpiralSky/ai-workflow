# AI Workflow status

Updated: 2026-11-03 14:11 UTC. This is the single current status file; dated notes are historical evidence, not a live queue. Update this file at each milestone or blocker.

## Running and since when

- Status reconciliation: local recovery completed 2026-11-03 14:07 UTC; sanitized external checkpoint preparation resumed at 14:08 UTC, in isolated worktree `ai-workflow-status-ledger`, branch `dot/status-ledger-20261103`, from `21fcab098837dced6d034905ae9bfe809c4c401a`.
- Anti-cheating list and PR guides: delivered directly in chat, as reported by the coordinator today. Security reconstruction/review remains a separate unfinished action; its execution start is not established here.
- Real model evaluation: **not running**. No current baseline repetitions, timing/token measurement, or baseline-versus-idea comparison has been established. The local process-name check found no Node, Python, Docker, or Podman job; it does not prove remote jobs are absent.

## Latest decisions and immediate blocker

- **Before any new actor run:** recover or rebuild the shell-safety/data-only persistence fix, test hostile characters, and externally checkpoint it. The missing `620a421` is not a verified fix. This is the immediate run blocker.
- **Native comparisons are screening only.** The user accepts procedural subagent isolation for free usage. Never present screening as proof that an idea beats baseline; keep a list of qualifying ideas for later isolated confirmation. **Do not build that runner now.**
- **Reduce accidental leakage:** keep graders/reference answers out of worker environments during runs; grade afterward outside their reach. Use unique canaries in grader files and run outputs, flag unexpected canary exposure as contaminated, and audit tool logs for outside-workspace reads. These controls are requirements, **not yet verified implemented here**. No actual canary or private content belongs in this public file.
- **Three-hour reflection:** omit token-wastage assessment because native usage is unmeasured; retain other reflection/checkpoint duties. Do not invent native token or money totals.

## User priority order and gates

1. **Anti-cheating list first:** describe cheating, prevention, and what cannot be prevented. User must be able to read this before trusting results. List delivered to the user; this disclosure does not itself clear the technical security gates.
2. **Baseline noise:** run baseline at least twice on the same task from the same commit, and report differences. **Not measured.** Two observations are a minimum diagnostic, not a reliable variance estimate by themselves.
3. **Isolation and equal starts:** verify the mechanism and exact starting commit for every run. Development worktrees are verified locally; isolation of experimental runs is **not yet verified**. Separate worktrees alone do not prove container, credential, network, cache, or grader isolation. Native actor isolation is procedural: an ordinary subprocess can access same-user resources. The user accepts this limitation for screening, with the leakage controls above; it is not a verified security boundary.
4. **One real run:** report elapsed time and token usage to plan comparison capacity. **Not measured on the current frozen setup.** Real native elapsed time can be recorded, but native token usage is unavailable and must stay unknown. Mock tests, fixture checks and CI duration do not satisfy this gate.
5. **Small fixed comparison only after 1–4:** freeze tasks, baseline/candidate commits and settings before execution. **Not started.** The older 60-cell/300-potential-cell design is not the next dispatch plan.

No Codex task is started for this work. No default/protected branch changes, approvals, merges, force pushes, destructive actions, or paid/model calls are part of this status update.

## Done, with evidence

- **Current local checkout verified:** original progress worktree clean at `21fcab0`; classifier review clean at `b810601`; provider/sign-in review clean at `9ed722f`; full-fixture worktree clean at `b1190e3`. Verified by `git status`, `git log`, and `git worktree list` today. These are different source snapshots, not interchangeable experiment starts.
- **Local-only recovery limit verified:** `git cat-file -t 620a421` fails in the available ai-workflow object database. The earlier reported local checkpoint is **not present here**, and no result depending on its contents is claimed recovered.
- **Historical implementation evidence retained:** the Nov 1 classifier composition record at `b810601` reports 591 package +22 script checks, typecheck, original-spec preservation and 42 focused checks. This session has inspected that record/source; it has **not rerun those checks**. Fixtures at `b1190e3` are a separate composition, not a current classifier benchmark.
- **External review state:** draft PRs [#1 migration](https://github.com/SpiralSky/ai-workflow/pull/1), [#2 sign-in](https://github.com/SpiralSky/ai-workflow/pull/2), [#3 DeepSeek](https://github.com/SpiralSky/ai-workflow/pull/3), [#4 classifier](https://github.com/SpiralSky/ai-workflow/pull/4); classifier native CI [run 41279632208](https://github.com/SpiralSky/ai-workflow/actions/runs/41279632208). The coordinator reports no recorded reviews and zero current-head CI statuses for PRs #1–4 today; old CI is not current-head validation. Links and earlier CI success are recorded in `21fcab0`. Fixture/native CI success is not model task success.
- **Later remote evidence recovered:** the verified public backup at `3e3b715` includes a [Nov 2 registry](../ideas/experiment-registry.md), shared-framework acceptance record (755 Node +12 normal/12 optimized Python checks and TypeScript checks), and bounded native pilot records. These are historical records read today, not tests rerun by this status task; they do not establish current same-commit baseline noise or a production cost comparison.
- **Private backup integrity verified:** an independent restoration worker reports Space backup version 0 has SHA-256 `034b849ac81401e4d2ab624a5024cec466c2854beea2b0b1abf59abde05490eb`; ZIP integrity passes. All 26 manifest entries match SHA-256, size, and recorded Git blob IDs; one manifest is self-excluded. Static verification only: no restored code executed, no private content published, no isolation or benchmark-success claim.

## Blocked, and on what

- **Later isolated confirmation:** neither `docker` nor `podman` is on this executor's PATH today. This does not block user-authorized native screening once its immediate safety gates pass. Do not build an isolated runner now; record qualifying ideas for later confirmation.
- **Security and experiment admission:** the prior data-only persistence patch `620a421` is unavailable here and unverified externally; reconstruct and independently review it before actor runs. The verified [public backup checkpoint](https://github.com/SpiralSky/ai-workflow/commit/3e3b7152eb29878aa1f0f85f697672eb0e6369ba) lacks private grading pieces; the private backup has now passed archive and manifest verification, but usable code reconstruction and independent security review are still pending. No live model backend or token usage is verified. Native actor tests were authorized, but are not equivalent to production orchestration or comparable benchmark results. Provider authorization is not declared missing; its exact applicable scope must be checked before any action requiring it.
- **External checkpoint of this file:** publication preparation is active; exact remote readback must pass before calling it verified. The remote public-backup head was freshly read as `3e3b7152eb29878aa1f0f85f697672eb0e6369ba`; only this sanitized file will be added on a dedicated status branch, not the older local source tree.
- **Historical Codebase Memory graph blocker:** Nov 1 notes record Unix IPC denial and no successful index/query. Not retried or represented as verified working today.

## Independent work instead

Evidence-ledger recovery is locally committed; sanitized external checkpoint preparation is active. Preserve the already delivered anti-cheating/PR guidance. Continue independently authorized shell-safety reconstruction/review, hostile-character tests, source/fixture recovery, and leakage-control preparation. Do not start actor runs before the safety fix is externally checkpointed; do not build the later isolated runner. Preserve each blocked action's state. Do not retry canceled actions or route around denials. If these independent actions finish and no authorized work remains, replace this section with **STOPPED**, name the remaining dependency, and notify the user.

## Idea ledger

Use the [deduplicated registry](../ideas/experiment-registry.md) for full historical evidence. These statuses reflect that verified remote record, not the older local Nov 1 source alone. No global effectiveness or monetary-savings winner is established.

| Idea family | Implementation / disposition | Measured status and next gate |
|---|---|---|
| Classifier filtering | Optional implementation; Jev/Microsoft/Perplexity are one family. Effectiveness deferred. | Named-model quality, recall, task completion and billing remain unmeasured here; native substitutes cannot establish them. |
| Scoped selector reuse | Remote prototype `3adfa8c`; library-only, not Task/runner exercised. | Recorded synthetic 6-query replay reduced calls 6→4; not real-task success or monetary savings. Establish eligible repeat opportunities before wiring. |
| Known-good hot paths | Remote prototype `8dcf05b`; current two-snippet policy is parked, branch retained. | Recorded bounded pilot: both arms 2/2 tasks and 97/97 checks, with higher snippet payload proxy in all nine scenarios. Not a production orchestrate comparison or proof the family cannot help. |
| Static-context/type interning | Independent candidate recorded in registry; focused tests/survey reported, present implementation not independently inspected here. | Aggregate/native quality evaluation pending. Declaration bytes are not measured tokens or dollars. |

`rerank=none`, lazy tool search, reference passing and BM25 caching are existing mechanisms/controls, not newly invented or measured improvements. Hypotheses remain distinct from diagnostics and shared correctness fixes. Before any next comparison, apply the immediate safety blocker and the user-priority gates above. **Qualified for later isolated confirmation: none established by this recovery task.** Screening evidence can nominate a candidate, not prove a winner.

## Local-only work and checkpoints

- **This ledger:** `docs/dot-progress/CURRENT.md`, local branch `dot/status-ledger-20261103` from `21fcab0`; intended remote branch of the same name from freshly verified `3e3b715`. Their Git ancestry differs intentionally: only this sanitized file is transferred. Commit-linked publication/readback evidence will identify the remote checkpoint; local Git history does not by itself prove publication.
- **Other local source branches:** preserved unchanged. A matching remote branch/tree must be verified before calling any local source externally backed up; prior recorded PR commits were created through the API and differ from local commit IDs.
- **Missing prior checkpoint:** `620a421` remains unrecovered in this checkout. This status task attempted no deletion, replacement, cherry-pick, or fabricated recreation. Any reconstruction must have a new identity and fresh evidence.
- **Scheduled checkpoints:** coordinator reports an automation created every three hours, first scheduled 2026-11-04 01:05 Singapore time (2026-11-03 17:05 UTC). Execution and environment persistence are unverified; a schedule is not a successful backup.
- **Publication hygiene:** this file contains no credentials, hidden grader content, raw logs, run artifacts, or private source dumps. Publish only an authorized, reviewed checkpoint, never an entire local tree by default.
