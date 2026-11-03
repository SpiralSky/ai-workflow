# Rebuilt actor-data capture (draft)

## Authority and provenance

The user requires the shell-safety fix, hostile-character tests, and an external
checkpoint before any new actor runs. This isolated development branch starts at
public commit `3e3b7152eb29878aa1f0f85f697672eb0e6369ba`. Lost local commit `620a421`
was not recovered; this implementation is a new rebuild, not evidence of identical
code, restoration of its tests, or resolution of the earlier incident's unknown
process/network effects. No spec/plan approval, merge, model call, or paid API run
is performed by this work.

## Fixed data channel

The coordinator chooses the canonical cell directory, arm, and action sequence.
`actorDataCommand` constructs only the fixed Node helper command from that trusted
metadata. It rejects shell-sensitive paths. Never put actor text into a command,
heredoc, command argument, source-code literal, Python program, or shell variable.
Shell escaping and JSON-stringifying text inside a command are not this channel.

1. Start the fixed `actor-data.mjs CELL_DIR ARM SEQUENCE` command with a PTY and a
   short initial yield. Require its complete `actor-data-ready` marker with version
   `actor-data-stdin-v1` before sending any bytes. The marker is emitted only after
   raw terminal setup and exclusive capture reservation. A session ID or elapsed
   yield alone does not prove readiness; early sends can echo or transform bytes.
   A readiness marker is not completed capture.
2. Supply exactly the actor's one UTF-8 JSON action line, including its final LF,
   through the `chars` field of `write_stdin` for that helper's verified session.
   Do not concatenate any command text. The helper uses only file APIs and parses
   JSON for protocol validation; it never executes the content.
3. Require normal exit code zero, complete bounded metadata output, and matching
   stored raw-byte SHA256/length and receipt. On rejection, cancellation, timeout,
   truncation, uncertain exit, or any mismatch, preserve files and stop the cell.
   Never retry that capture or relay its action. A printed receipt without normal
   exit is insufficient. Do not reinterpret a failed attempt as no effects.
4. Only after these checks, send the same unchanged line through `write_stdin.chars`
   to the verified existing supervisor session. This is a separate data operation,
   never a shell command. The native supervisor verifies the captured file and
   receipt against these exact bytes before writing anything to worker stdin.

The coordinator must additionally recheck the live assignment deadline before
relay. The capture's own 60-second bound does not extend the supervisor's existing
15-minute assignment limit. The normal action-receipt tracker still reserves the
input, blocks replay/coalesced actions, and binds worker feedback.

## Bounds and evidence

- One frame, at most 98,305 bytes including LF; 1,024-byte output ceiling.
- Strict UTF-8 and existing protocol validation; no payload echoed on failure.
- Exclusive input, attempt, and receipt paths. Partial/failed attempts are retained.
- Idle input, emission acknowledgement, cancellation, and late completion fail
  closed. Synchronous bounded filesystem operations are checked before/after; this
  is not an OS-enforced kill deadline or a guarantee against hostile filesystem races.
- Capture receipt attests local exact bytes only, not actor authorship, execution,
  transport delivery, normal process exit, or hard isolation. The coordinator must
  observe exit zero. A peer with shared filesystem access can forge local evidence.

## Validation and remaining blockers

The fresh exact public export first passed its original 57 synthetic protocol,
handoff, bootstrap, and receipt controls, plus 16 controller controls. The rebuild's
11 new controls cover literal hostile shell text, byte limits, split Unicode/CRLF,
invalid encodings/framing, sticky failed attempts, deadline/cancellation, failed or
hanging output acknowledgement, receipt tampering/links, and an actual pipe CLI.
The supervisor integration check in that initial set is a source-level assertion,
not a full native-session test. Additional review and final test results are recorded
below when established. Logs and synthetic payloads remain outside the repository.

The public export excludes private grading assets and several source-binding
inventories/notes. It cannot presently perform complete campaign admission or
grading. No aggregate suite, native actor, comparative cost, full-task success,
grader secrecy, or safe grading of hostile submitted code is claimed. Same-account
native comparisons, if later unblocked, are screening only; they cannot establish
that an idea beats baseline. This change builds no isolated runner.

## Final shell-safety review and controls

Independent review found and reproduced two transport gaps in the first rebuild:
extra chunks during pending output were ignored, and a PTY send before raw-mode
setup could echo/transform bytes. Both were corrected before any actor use. Input
and error guards now remain active through completion; a bounded READY handshake
after raw-mode setup/reservation is mandatory before the coordinator sends data.
READY and final receipt share the same deadline and total output ceiling.

Final selected validation: **132 tests passed, zero failures/cancellations/skips**.
This combines the original public controls, 16 controller controls, 13 rebuilt
capture controls, and aggregate-launcher contract tests. A separate reviewer ran
90 focused controls plus additional late-input, READY-output and cancellation
probes and found no remaining blocker within the helper's stated scope.

The real tool PTY path preserved a maximum **98,305-byte** action with exit zero,
no payload echo, and an exact matching retained SHA256 and byte count. Independent
PTY probes also preserved CRLF/Unicode and the maximum frame, with 323/325 output
bytes. These were synthetic inputs, never model actors or project tool execution.
Syntax checks and `git diff --check` passed. Full native supervisor execution and
the complete repository suite remain unverified, not silently skipped or passed.

Reviewed helper SHA256:
`39b750ec9de3e3b4dd426990df17889eba80d7a986555008c8bdf1eab8585037`.
Reviewed supervisor SHA256:
`15104753ed8bf37b6bce1656ac86bdefb7a84aadd662af0afdde69706a295c03`.

An external source checkpoint is required before actors. Publication of this
public-only patch does not resolve the separate grading/isolation blockers.
