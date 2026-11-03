# AI Workflow status

Updated: 2026-11-03 16:37 UTC. This is the single current status file; dated notes and Git history retain earlier milestones.

## Running and since when

**Investigating minimal pinned actual-orchestrate wiring**, active as of 16:32 UTC. Existing candidate: [commit `8dcf05ba`](https://github.com/SpiralSky/ai-workflow/commit/8dcf05bad0c0f7c806db3d7350060435018773f8), with a planned feature-flag off/on contrast on that same commit. **Candidate actor execution stopped before launch:** metadata inspection identified **18 hidden-test/reference paths** in the public candidate checkout. Their contents were not opened or deleted by that inspection. A sanitized operational export without Git history and bounded cleanup of the recoverable checkout are under review, not completed. No actors/model runs are underway; two completed direct controls are **not evaluations of the actual orchestrate implementation**.

Reviews and private evidence have been recorded. The final **644-file private bundle was independently verified before cleanup**. Completion of sensitive/candidate-file cleanup is not asserted here; verify scoped absence before any future solve. Three-hour checkpointing remains enabled.

## Completed screening result

[Published direct-harness baseline report](https://github.com/SpiralSky/ai-workflow/blob/fa3111fa9cca7129b6a8f42473108f7ba07304a9/docs/dot-progress/calendar-direct-baseline-repeats-20261103.md), verified readable today.

Both sequential `calendar-window` direct-arm assignments used commit `7819bf1a124f2a7606708dc5989e74fa0a1a3dd7`, identical declared task/handoff/runtime/limits, and froze before private grading. First-cell backup/restore (161 files), scoped answer-copy removal and bounded absence checking preceded the second solve.

| Observation | Repeat one | Repeat two |
|---|---:|---:|
| Supervisor wall time | 365.29 seconds | 301.17 seconds |
| Acknowledged rounds | 6 | 5 |
| Host calls | 13 | 13 |
| Public-plus-added visible tests | 14/14 | 14/14 |
| Cooperative private executable checks | Pass | Pass |
| Local fixture acceptance gates | Pass | Pass |

Difference: **64.12 seconds, about 17.6% of the longer run**. Wall time includes setup, checking, assignment, relay, idle and cleanup. Two observations do not establish precise variance, pure model latency, or a justified repeat count. Native tokens, cache usage and billing remain unknown; byte counts are not substitutes.

Independent review confirmed permitted changes, protected-test preservation and a meaningful regression control that fails original code and passes both submissions. Both private grades used the same independently checkpointed corrected-mode package. **This establishes limited cooperative direct-harness screening only: no optimization was tested, no idea was promoted, and no superiority or production-correctness claim follows.**

## Limits and remaining gates

- **Candidate checkout contains reference paths:** metadata inspection found 18 hidden-test/reference paths at candidate `8dcf05ba`; no identified file contents were read or deleted. Do not expose the original checkout to actors. The proposed no-Git operational export and bounded recoverable-checkout cleanup require review and verification; neither procedural withholding nor removing Git history establishes isolation.
- **Actual candidate identified, execution path incomplete:** pin `8dcf05bad0c0f7c806db3d7350060435018773f8` for both flag-off/on arms. The existing native relay constructs baseline/branch-only, not this orchestrate candidate, so relabeling it would not exercise the treatment. A completion bridge is absent. Minimal pinned wiring is being investigated with no-model controls only; no model evaluation has run.
- **Unknown usage must remain unknown:** the existing numeric usage contract cannot honestly represent unavailable native usage. A faithful representation is under investigation; do not fill missing usage with zero, invent token/cost measurements, or claim the current adapter already satisfies that contract. No broader infrastructure is planned.
- **Cooperative reach limitation remains accepted and explicit.** Graders/reference answers were withheld procedurally from known solve-time copies; submitted code may reach grader resources during post-solve grading under the same OS user. Shared plugin access and unknown copies are not isolated.
- **Audit incomplete.** Available submission/relay/journal evidence reported no literal canary hits or observed out-of-workspace host arguments. Full native tool logs were unavailable; subprocess reads were unobserved. Unmarked copies remain a detection gap. No-hit evidence is not proof of no leakage.
- **Future-solve hygiene:** verify private grader/reference/candidate evidence is checkpointed and off the scoped solving filesystem before another actor. Do not infer absence everywhere from bounded checks.
- **No new isolated runner.** The user accepts cooperative screening; later isolated confirmation is separate. Do not build that runner now or infer paid/API authority from code or status publication.

## User priority sequence

1. Anti-cheating list delivered directly in chat, including prevention and unenforceable limits.
2. Two same-task/same-commit direct controls now have measured wall times and matching local fixture outcomes. Two observations are preliminary; actual orchestrate baseline noise is not measured.
3. Declared inputs and sequential workspaces were matched; separation is procedural, not a security boundary.
4. Real direct-harness wall time is measured above. Native token usage remains unavailable.
5. Baseline-versus-idea comparison on a small fixed task set **has not started**. Candidate `8dcf05ba` is identified for matched flag-off/on arms; completion bridging and honest unknown-usage handling remain prerequisites.

## Completed technical checkpoints

These are implementation/control results, not additional independent model evaluations. Test sets may overlap; do not add their counts.

- **Actual-candidate no-model checks:** **120 core tests** and a **four-arm synthetic probe** passed before the metadata finding. These exercise controlled code paths, not native/model actors, task quality or an orchestrate comparison. The subsequent reference-path finding remains a separate unresolved actor-admission blocker.
- **Shell safety:** local replacement `4a6c560`, [remote `88c9d6a7`](https://github.com/SpiralSky/ai-workflow/commit/88c9d6a7ebbbe2cd3fbacfe2754de09a1f4e002d), 132 selected checks and independent review. Six remote files and reviewed tree `c9cb3aa2f40e60e0a0c1b22323a7149fda600967` verified. Missing old `620a421` was not recovered or relabeled.
- **Public preparation:** [remote `6aa8586c`](https://github.com/SpiralSky/ai-workflow/commit/6aa8586ca525cce08defafe82bc6cdfc7733c692), five public files verified, 140 selected checks, independent review and 421 public files checked. Original full gates unchanged.
- **Cooperative controls:** [remote `771bd36c`](https://github.com/SpiralSky/ai-workflow/commit/771bd36c93000db9a7319328df257e14930e8b00), 11 source files verified, 199 selected checks and independent review. Remote tree `6fda763c7edd37b8aedfc863f6bdfc877d6b2f30`.
- **Submit/EOF repair:** local `38ea39a`, [remote `7819bf1a`](https://github.com/SpiralSky/ai-workflow/commit/7819bf1a124f2a7606708dc5989e74fa0a1a3dd7), reviewed six-file change and 98 selected infrastructure checks, including real-process upstream-input handling. The actual repeats used this repaired commit.
- **Public selected validation:** 205 passed, zero failures/skips. This does not erase the red expanded run below. Existing runtime copy was byte-verified; full registry SRI provenance was not established.
- **PR guidance:** [migration #1](https://github.com/SpiralSky/ai-workflow/pull/1), [sign-in #2](https://github.com/SpiralSky/ai-workflow/pull/2), [DeepSeek #3](https://github.com/SpiralSky/ai-workflow/pull/3), [classifier #4](https://github.com/SpiralSky/ai-workflow/pull/4). Earlier today the coordinator reported no reviews and zero current-head statuses; old CI is not validation of current heads. No approvals/merges.

## Retained failures and observed waste

- **One unusable pre-v2 actor attempt:** the old `771bd36` run hit the 900-second supervisor deadline after provisional submission; exit 1/incomplete at 15:41:45 UTC, cleanup uncertain in its terminal record. Six acknowledged actions and 8,031 recorded input bytes survived, but no submission snapshot or grade. It is preserved privately and excluded from successful repeats; no old candidate was salvaged.
- **One setup `ENOENT`:** failed before actor launch, distinct from the later dispatch. Separate setup elapsed cost was not established.
- **Expanded validation remains red:** 217/227 passed, nine missing legacy full-admission input failures and one missing optional-hotpath failure, zero host calls. Missing prerequisites explain scope, not a pass. The later 205-control run did not overwrite these failures.
- **One pre-execution grading setup failure:** matching fixture bytes had staged `0600` modes instead of admitted `0644`; no grading attempt/raw output was created. A separately checkpointed derived package corrected only already-public file modes, preserving original bytes and evidence. Both later grades passed; the initial failure remains separate.
- **Publication failures retained:** denied/nonexecuted attempts and a permitted Git retry that lacked CLI credentials remain history. Authorized sanitized checkpoints subsequently used the connector; no canceled giant-blob retry or bypass is claimed.

At three-hour reflection, report observable rework, retries, dead ends, blocked time, unusable runs and machinery time versus useful outcomes. Use measured/rough wall time and counts with their scope, never invented native tokens or money.

## Independent work instead

Review a sanitized no-Git operational export from pinned `8dcf05ba` and bounded cleanup of its recoverable checkout so reference paths are absent from the intended solving environment. Preserve exact source provenance without exposing excluded content. Continue no-model wiring and honest unknown-usage investigation; do not start actors, claim isolation or expand into broader infrastructure while these gates remain unresolved. Preserve the completed direct-control result and verify final private-bundle retention/cleanup before future solves. Do not launch another actor merely to avoid recording a blocker, alter old outcomes, weaken grading or treat direct controls as an optimization experiment. Keep useful authorized preparation moving around blockers; respect denials and ask when additional authority is required.

## Idea ledger

See the [deduplicated registry](../ideas/experiment-registry.md) for historical evidence. None was evaluated by the two direct controls.

| Family | Recorded state | Remaining evidence |
|---|---|---|
| Classifier filtering | Optional implementation; named-model effectiveness deferred. | Matched actual quality/recall/task-cost results. |
| Scoped selector reuse | Prototype `3adfa8c`, library-only. | Task/runner wiring and eligible repeat opportunities; historical synthetic 6→4 calls are not savings. |
| Known-good hot paths | Actual candidate `8dcf05ba`; 120 core tests and four-arm synthetic probe pass. Earlier two-snippet policy remains parked. | Metadata found 18 reference/test paths; sanitized export/cleanup review pending. Completion bridge and honest usage also unresolved; no actual matched model result. |
| Static-context/type interning | Candidate documented with focused checks/survey. | Aggregate/native quality evidence; declaration bytes are not tokens or dollars. |

Existing rerank-none, lazy tool search, reference passing and BM25 caching are controls/mechanisms, not newly measured ideas. **Qualified for later isolated confirmation: none.**

## Local-only work and checkpoints

- **Status branch:** local `dot/status-ledger-20261103` began at `21fcab0`; remote branch began at public backup `3e3b715`. Only this sanitized status file is transferred. Each published revision is checked for exact contents, branch head and status-only diff; the containing commit identifies this checkpoint.
- **Public results/code:** report and implementation checkpoints are linked above. **Private raw evidence:** final 644-file bundle independently verified; no raw candidate, grader, reference, receipt or real canary is published here. Cleanup must be confirmed before the next solve.
- **Candidate checkout/export:** original recoverable checkout contains the 18 metadata-identified paths. Sanitized operational export and cleanup are proposed/under review, not represented as completed or externally checkpointed. This status publishes neither path lists nor private contents.
- Other local branches remain preserved without a blanket claim of remote equivalence. Historical `620a421` remains unavailable. Original source checkpoints are not silently merged or reset.
- **Three-hour schedule enabled**, per coordinator confirmation. A schedule is not evidence of successful execution or environment persistence.
- No default/protected-branch edits, PR approvals, merges, force pushes, destructive actions, Codex tasks or paid/model calls occurred in this status task. Future writes remain scoped and authorized.
