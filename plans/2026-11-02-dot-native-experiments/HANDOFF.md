# Experimental handoff

Branch: `dot/dot-native-experiments-20261102`; base: `67b42ae`.
Plan created with the verified source Specplane CLI; remains draft. Work proceeds under the
repository's isolated experimental-development exception, not a fabricated ready/approval state.

Implemented `scripts/dot-native/{method.ts,cli.ts,method.test.ts}` and method documentation.
No production runtime/spec body edits, provider registration, model client, queue, automatic
worker call or live solver trial. Unknown accounting stays null. Artifacts stay ignored or in
exclusive disposable temp directories. No commits/publication were made.

Focused tests and type-check: see `docs/dot-progress/dot-native-method.md` for latest results.
Review before any pilot; parent/coordinator owns that authorization and quota caveat. Do not
present synthetic test success as model-assisted evidence or full-fixed60 success/savings.

Review follow-up: bounded reads now loop to EOF/cap and verify stable descriptor/path identity,
size, byte count and nanosecond mtime/ctime. Added mocked short-read and mutation regressions;
focused tests 14/14 and focused type-check pass. Model-client wording narrowed to invocation.

Second review follow-up: reservation moved before all input/source reads, after canonical run
directory validation. Invalid-input corrections cannot reuse an ID; unsafe/missing run paths are
not reserved. Focused tests 16/16 and type-check pass; no native pilot or commit by this worker.
