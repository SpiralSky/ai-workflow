# Public native handoff and fixed bootstrap proposal — draft

This document proposes the exact common actor-visible text below for root review. It does not
approve the template, admit an actor, freeze a campaign, launch a model, or change project-tool
budgets. Experimental implementation remains on the isolated development branch. No existing
attempts or screening artifacts are reused or deleted.

## Exact common template (method revision v2)

The UTF-8 text between the fences is exported as `PUBLIC_HANDOFF_TEMPLATE`; the closing sentence
is followed by one LF. Every arm receives identical template bytes. The coordinator appends the
exact public TASK and the exact original public ready JSON line, including its terminating LF.
The ready packet deliberately repeats the TASK, and every byte of both copies is counted.

```text
PUBLIC NATIVE ASSIGNMENT PROTOCOL v2
This is one finite native coding assignment. Solve the complete public TASK below using only the public ready packet and actual coordinator-relayed feedback. The TASK is also present inside the ready packet by design; both copies count toward the visible input bytes.
The common limit is 900 seconds from supervisor launch through close, including setup, bootstrap, assignment, idle time, relay, actions, and cleanup. Each action has a 60-second ceiling within that same deadline. There are at most 12 sequential action rounds, including the final submit round, and 60 total host-call attempts including failed attempts. Round 12 is reserved for submit. These limits are identical across arms and do not restart when this handoff is read.
Use the exact framework instructions and tool schemas in the ready packet. The sanctioned project tools are readFile, writeFile, edit, grep, findFiles, listDir, multiEdit, findDefinition, findReferences, check, and runTests, exposed directly or through the advertised branch tool. Use only relative canonical paths inside the fixture workspace. Write only paths in the exact allowedWritePaths list supplied in the public ready packet and enforced by the session; do not modify any other file.
After this one bootstrap invocation, the only permitted native-tool action is collaboration.send_message to the fixed coordinator target named in the initial bootstrap message, solely for the required action messages or an incomplete-status report. Do not use shell, general filesystem access, network access, any other native tools, other agents, models, providers, Codex, installs, or hidden/reference material. Do not inspect coordinator files or other cells. The bootstrap is the sole exception for reading this frozen public handoff through the supplied fixed helper command. It is not permission to read an arbitrary file or run another command.
Send exactly one JSON action line per turn to the coordinator, beginning at sequence 1 and increasing by one. After sending the action, immediately END the current turn with exactly "Awaiting coordinator feedback." as the final response. This fixed final response is not an action; do not repeat the JSON in it. Do not keep sampling, poll, call a wait tool, or send another action in that turn. The coordinator observes the ended/completed turn, executes that action exactly once, and resumes this SAME actor with collaboration.followup_task containing actual complete feedback. On that resumed turn, use the existing conversation context and prior sequence, then choose and send the next action and end again. Do not start a new actor per action or repeat the bootstrap. Direct actions use {"sequence":1,"kind":"tools","calls":[{"name":"advertised tool name","args":{}}]}; branch actions use {"sequence":1,"kind":"branch","code":"branch source"}. Match the tools advertised in the ready packet. Finish with {"sequence":N,"kind":"submit"} using the next sequence, no later than round 12. Terminal submit follows the same send-and-end rule with the same fixed final response; do not send another action after submit. Do not fabricate feedback, send concurrent actions, or use prose as an action or retry.
The fixed bootstrap emits the exact public TASK bytes and the entire original UTF-8 ready JSON line, including its newline. It reports actual byte counts and a terminal PUBLIC_BOOTSTRAP_END marker whose bodySHA256 covers every preceding output byte and whose outputBytes includes the terminal marker. No native tool output capacity is assumed or increased. If the tool reports truncation, any bytes or the terminal marker are missing, the counts/hashes do not match, or bootstrap fails, stop and report the incomplete handoff to the coordinator. Do not retry the bootstrap or reconstruct missing text.
A bootstrap receipt only records a local emission callback acknowledgement. It is not proof of transport delivery, model consumption, actor identity, hostile-actor isolation, task success, or billing/token usage.
```

The v2 template is 4040 UTF-8 bytes with SHA256 6c084b967aa3685fc54c93d13cf25afaa83b110299032b6e29dfc0f11f19f2a8. It replaces the v1 implied waiting convention with explicit one-action turns and same-actor continuation. The protocol identifier is native-interactive-public-bootstrap-v2. No project runtime, limit, parser, transport, or supervisor behavior changes with this revision.

## Exact initial bootstrap message (v2)

The generator substitutes only measured output bytes, the handoff digest and the fixed quoted command components. Both shown lines end with LF.

```text
Coordinator: /root/restore_development_branch. Run exactly the fixed command below once through exec_command, requesting yield_time_ms=30000 and max_output_tokens={expectedBootstrapOutputBytes}. The tool capacity is unknown. If the single call is rejected, nonterminal, session-only, truncated, failed, incomplete, or missing the complete PUBLIC_BOOTSTRAP_END marker, report incomplete to the coordinator via collaboration.send_message and END the turn. Do not poll, call write_stdin, repeat exec_command, or use another reader. Expected public handoff SHA256: {handoffSHA256}. After this one bootstrap, use only the coordinator relay described in its output; no other shell or filesystem access.
'{nodeExecutable}' '{fixedRepository}/scripts/native-interactive/bootstrap.mjs' '{canonicalCell}/public-bootstrap.json' '{capabilitySHA256}'
```

The request uses the supported30,000ms maximum yield, not a guarantee the helper's60,000ms local bound completes within one tool call. A running session is an incomplete bootstrap under this one-call protocol, never authorization to poll. Requested output allowance remains a request, not a known tool-capacity or token measurement. The fixed command and generated initial message are intended artifacts; actual native delivery and consumption remain procedural.

## Public byte and identity contract

`generatePublicHandoff({task, readyFrame, bindings})` is pure and returns a Buffer payload and
manifest. `verifyPublicHandoff` regenerates the complete expected bytes and manifest and fails
closed on any difference. `parsePublicHandoff` uses validated byte offsets to recover the exact
TASK and raw ready frame and then invokes that verification. UTF-8 decoding is strict. The raw
ready line is parsed only for validation, never reserialized into the handoff. The ready packet
must include an explicit `allowedWritePaths` array from the session configuration, identical for
the same fixture in every arm. Its entries must be unique canonical relative POSIX paths: no
absolute paths, empty paths or segments, dot/dot-dot segments, backslashes, or NUL bytes. An empty
list authorizes no writes. The common template points directly to this exact public list instead
of assuming the TASK enumerates every permitted path.

The independent bootstrap bounds are TASK 32,768 bytes, ready 98,304 bytes including LF, and
payload 147,456 bytes. Each metadata file is bounded at 16,384 bytes. These are allocation/read
ceilings proposed for freezing, not root-approved evidence of sufficiency, a claim about native
tool output capacity, or a change to existing tool budgets.
The handoff contains only the common template, public TASK, public ready frame, and deterministic
section framing with actual byte counts and hashes. Private lineage is not included in it.

The manifest binds template, TASK, raw ready frame, payload, and exact source, assignment,
admission, campaign, cell, and protocol identities, with actual sizes and byte offsets. Required
bindings are `cellDir`, `cellId`, `cellIndex`, `fixtureId`, `arm`, `campaignSHA256`,
`sourceBindingSHA256`, `assignmentSHA256`, `admissionSHA256`, and `protocolSHA256`. The cell
basename must equal its ID. The coordinator separately validates the canonical campaign ancestor,
actual assignment, frozen sources, readiness, and deadlines. These pure helpers cannot establish
those facts by themselves.

## One supported bootstrap command

The only supported actor bootstrap invocation is:

```text
node <fixed-helper>/bootstrap.mjs <canonical-cell>/public-bootstrap.json <expected-capability-SHA256>
```

The command takes exactly those two arguments after its fixed script path. It has no arbitrary
filename or general read operation. The capability is generated before intent and confines reads
to the exact cell's `public-handoff.txt` and `public-handoff.json`. The helper additionally reads
only the fixed `actor-dispatch-intent.json` to bind the prior intent. It never emits that metadata.
All input files require canonical regular files, one link, no-follow opens, bounded reads, and
stable before/open/after metadata and path checks. The capability bytes must use the generator's
exact encoding and match the command's supplied digest.

`generateBootstrapCapability({cellDir, manifest, manifestBytes})` returns `{capability, bytes,
sha256}`. The coordinator persists the exact bytes with exclusive creation before intent.
`generateBootstrapOutput` (alias `formatBootstrapOutput`) deterministically returns the complete
output Buffer, enabling the coordinator to report its actual length and SHA256 without estimating
a tool token budget. `verifyBootstrapOutput` rejects every changed byte, truncated result, reordered
section, added suffix, or missing terminal LF. The final `PUBLIC_BOOTSTRAP_END` marker reports
total output bytes and hashes all preceding bytes. Its hash is not a self-referential whole-output
hash; the receipt also records the SHA256 of the entire output, including this final marker.

Immediately after authenticating the exact capability bytes/hash and canonical fixed cell/path,
the helper durably reserves exclusive `public-bootstrap-attempt.json`, before reading the manifest,
payload, or dispatch intent. Unauthenticated path/hash failures do not write anything. A subsequent
validation failure consumes the attempt even if the underlying file is later repaired. The attempt
binds the authenticated capability and cell; the later receipt also binds full validated output. After the
full local stdout callback acknowledgement it creates exclusive `public-bootstrap-receipt.json`
with status `emitted`. Failed, missing, or partial acknowledgements record `failed`, null emitted
byte identities, and an error, retaining the attempt. If receipt persistence itself fails, the
retained attempt still blocks a second emission. A preexisting attempt or receipt blocks reuse.
Nothing overwrites an earlier record.

The helper has a fixed local 60,000-millisecond emission deadline measured monotonically from
invocation, including time already spent in bounded reads and verification. It cannot infer the
remaining supervisor deadline across clock namespaces and does not reset or extend the authoritative
900-second supervisor budget. CLI arguments cannot override this local bound. A hanging output,
expired acknowledgement, or rejected callback records failure and keeps the reservation. Timeout
aborts only the helper's own stdout stream; late callback success cannot change the failed receipt.
Synchronous filesystem calls and receipt persistence are not claimed to be preemptible kernel-I/O
wall-clock guarantees. Injectable clocks/emitters are solely deterministic test seams.

Receipts bind the full manifest, exact capability bytes/digest, raw manifest bytes/digest, dispatch
intent digest, attempt digest, and expected/emitted payload/output byte counts and hashes.
`verifyBootstrapReceipt({receipt, manifest, capability, capabilitySHA256, payload,
dispatchIntentSHA256})` recomputes the output and attempt identity. The coordinator separately
compares actual persisted records and gates first actor input and final native evidence.

## Evidence limits and required decision

A callback receipt is procedural local evidence. It does not establish tool transport delivery,
model consumption, native actor identity, hostile-actor security, task success, billing, or tokens.
The shared machine is not a hostile-code sandbox; canonical read checks assume quiescent ancestors
and do not provide atomic defense against malicious directory replacement. An actor must stop if
the supported tool truncates or omits any framing bytes, even when an emitted receipt exists.
It must not retry, use another reader, or reconstruct the content from prose.

Root must approve the exact common template and review composed coordinator integration before
any actor admission. Local tests are synthetic controls only; they do not approve production
campaigns. Plans remain draft. No aggregate/project pass or native outcome is claimed here.

## Fresh focused controls

The focused tests cover exact Unicode/raw bytes, repeated TASK accounting, independent limits,
manifest/source/identity tampering, truncation/reordering/extra suffixes, no-follow canonical reads,
hardlinks and special/oversize files, mutation during reading, fixed path confinement, mandatory
prior intent, one-shot concurrent invocation, failure receipts, receipt tampering, and fixed CLI
argument/complete-output behavior. Synthetic artifacts and focused logs are retained for review.
