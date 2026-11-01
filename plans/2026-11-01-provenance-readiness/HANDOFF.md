# HANDOFF — provenance readiness

Plan remains draft. Experimental source changes live on `dot/provenance-readiness-20261101`, based on exact `7caf329`; not a started/approved Specplane plan.

Implemented source/task/bundle/config byte snapshots, actual server/runtime/image observations, pre-model persistence and drift checks, immutable-image grading, complete-map finalization, and requested-vs-provider-observed model telemetry. No raw launch arguments or credentials are hashed/logged; hidden checks contribute only a hash. See `docs/dot-progress/provenance-readiness.md` for exact evidence and limitations.

Integration must preserve the newer `problemImageRef` fallback when replaying the grade.ts optional-image hunk, rebuild the shared bundle after all source changes, and run the authoritative full suite. Source-only validation is not a claim that the deliberately stale generated artifact works. No paid model/API/auth calls or Docker operations were run; fake Docker fixtures are marked as such.

No approve/ready/finish/merge/push operations were performed. Final plan/merge decisions remain human-controlled.

Security follow-up: reverse inference now starts closed and is admitted only after verified provenance persistence succeeds. Early initialize/list calls reject without queuing or allowance consumption; cancellation and cleanup revoke permanently.134 runner tests/typecheck passed, with independent14-test security reproduction. Plan remains draft; this internal review is not approval/finalization.
