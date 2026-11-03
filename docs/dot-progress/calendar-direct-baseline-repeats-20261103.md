# Calendar direct-harness baseline repeats

Status: experimental, limited cooperative screening. No optimization was tested or promoted. These are native direct-harness controls, not evaluations of the actual orchestrate implementation.

## Frozen setup

- Public harness commit: `7819bf1a124f2a7606708dc5989e74fa0a1a3dd7`.
- Public tree: `1ad08d8ff07e151f49663f4dc2fb19a227cb4600`.
- Fixture: `calendar-window`; direct arm; two fresh sequential assignments.
- Both used identical public task, ready packet and handoff payload, the same existing byte-pinned runtime, and the same fixed limits: 900 seconds, 12 action rounds, 60 host-call attempts.
- Both submissions were frozen before private grading. The first candidate and its output were privately checkpointed, restored for verification, then removed locally before the second solve.
- Grader/reference withholding was procedural and checked only for known copies. Shared tools and same-user access were not isolated.

## Results

- Repeat one: submitted and cooperatively closed, process exit 0; 365.29 seconds supervisor elapsed, 6 acknowledged rounds, 13 host calls; 7,174 action-input bytes and 5,414 feedback bytes.
- Repeat two: submitted and cooperatively closed, process exit 0; 301.17 seconds supervisor elapsed, 5 acknowledged rounds, 13 host calls; 7,528 action-input bytes and 6,048 feedback bytes.
- Each passed 14 public-plus-added tests and the separately restored private executable checks. Independent review verified permitted changes and a meaningful added zero-limit regression that fails against the original public implementation and passes against the frozen candidate. Original protected tests remained unchanged.
- Both local fixture acceptance gates passed. That is a result of this cooperative protocol, not evidence of hostile-code isolation or production correctness.

Elapsed time includes setup, checking, assignment, relay, input idle and cleanup. Worker input-wait observations were 351.40 and 286.32 seconds; helper-active observations were 6.00 and 6.56 seconds. These are not model-latency measurements. The roughly 64-second gap between two repeats does not establish a precise noise estimate or a justified repeat count. Actual tokens, cache usage and billing are unknown; byte counts are not token or cost measurements.

## Audit and retained failures

- Both retained submission/relay/journal audits reported no literal canary hits or observed out-of-workspace host arguments. Complete native tool logs were unavailable and subprocess reads were unobserved. No-hit results do not prove no leakage. Unmarked original backups and reference patches remain known detection gaps.
- An earlier attempt at `771bd36` hit the 900-second supervisor deadline after provisional submission because the worker input remained open. It is preserved privately as an infrastructure failure and is not included among successful repeats. The repaired transport closes worker input after validated submit; neither failed code nor the earlier candidate was salvaged.
- The first post-solve grade preflight stopped before execution because the marked archive stored public workspace files as mode 0600 while admission required 0644. A separately checkpointed derived package changed only those four already-public file modes. All source/canary bytes and other modes stayed unchanged; original archive and staging evidence were preserved. No gate was weakened.
- Selected public controls: 205 passed, zero failures or skips. An expanded selection remains recorded as 217 passed and 10 failed: nine legacy default-full tests require deliberately absent source inputs; one all-arm test requires an absent optional hotpath checkout. These unchanged unavailable paths are not claimed to pass.

## Interpretation and next gate

The repaired direct transport can complete, freeze, audit and grade this fixture under the stated cooperative limits. This checkpoint does not test orchestrate, establish an optimization benefit, or qualify any idea for isolated confirmation. A future comparison must identify an existing actual orchestrate candidate and a faithful matched baseline path before fixing its small task set and order. Private evidence and grader/reference/candidate output must be verified off the solving filesystem before any future solve.

Raw submissions, grading output, independent controls, receipts and failure evidence are retained privately; no candidate solution, hidden test, reference answer or real canary literal is included in this public note.
