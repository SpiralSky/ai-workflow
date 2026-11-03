# Native submit input close

Status: experimental, unmerged. Base checkpoint: `771bd36`.

The first cooperative baseline attempt remained incomplete. Its worker recorded
submission and cooperative resource closure, but the supervisor could not observe
worker exit while the relay terminal kept its input open. The fixed assignment
ceiling expired at approximately 900,020 ms and the worker received SIGKILL. The
failed attempt and its receipts are retained separately; no successful snapshot,
private grading result or second actor is claimed for that attempt.

## Fix

After a complete native submit frame has passed the action tracker and exact
actor-data receipt checks, the supervisor marks input submitted and closes only
the worker's input pipe while forwarding those final bytes. Worker feedback and
receipt acknowledgements continue draining normally. Subsequent upstream bytes
are counted and fail the attempt. Upstream EOF before a submit acknowledgement
still fails closed; EOF after acknowledgement remains valid. The actor protocol,
fixed budgets, native lineage, snapshot gates and private grading gates are
unchanged. Synthetic finite-input transport retains its earlier behavior.

The repair was developed in a separate checkout. The failed attempt's code and
running process were not changed or salvaged.

## Validation

- Six real-worker synthetic transport controls cover open upstream input,
  post-submit extra/repeated input, early EOF, acknowledged EOF, invalid captured
  actor-data evidence, and a split submit frame.
- Two existing actual-worker controls retain finite read/submit behavior and
  reject EOF without submission.
- Ninety protocol, action-data, receipt and test-runner controls pass.
- Independent reproduction confirmed the original open-input hang. A separate
  actual-process probe of the repair exited naturally with code zero, successful
  submission, closed cleanup and one acknowledged receipt while upstream stdin
  remained open. No fallback EOF or watchdog was needed.

These controls use synthetic public tasks and no actors, models, private graders,
network installs or paid APIs. Dependencies come from the pre-existing verified
runtime, with workspace links resolving to the isolated checkout; nothing was
installed. Test artifacts are retained separately. This is selected validation,
not a complete repository test or a successful baseline model result.
