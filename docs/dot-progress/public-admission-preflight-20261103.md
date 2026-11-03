# Public baseline preparation preflight (draft)

## Scope and preserved gates

This change adds a read-only public-input preflight. It separates evidence that can
be verified without private grading material from the still-blocked full admission
path. It does not create cells, admit campaigns, run actors, execute candidate
Python, grade submissions, or construct an isolated runner.

`inspectPublicAdmissionInputs` requires a canonical Git checkout and records
the current commit/tree, exact tracked public source bytes, public fixture task and
workspace bytes, write allowlists and public-test targets. Files are bounded,
regular, unaliased and checked directly against committed Git objects. Existing
filesystem readers assume quiescent files; directory enumeration is not a hostile
resource boundary, and hostile mutate/restore races are not excluded. It never opens the
private grader, private reconstruction notes/inventories, or optional hotpath
checkout. Changing an ignored private file does not change public-input identity.

Every result explicitly says `readyForActors: false` and `readyForGrading: false`.
Private-file presence, installed runtime closure, untracked runtime files, overall
checkout cleanliness, and complete native tool-log coverage are **not assessed**,
never inferred from a public-input pass. Repository-wide `git status` is deliberately
not run: it can read unrelated files or invoke configured filters/fsmonitor. The existing
coordinator, sourceBindings, campaign admission, grading, and review logic are
unchanged. Their existing full gates remain required by default. Missing private
assets are not silently ignored or treated as successful grading.

The command is `node scripts/native-interactive/public-admission.mjs` from this
checkout. It only prints a compact preparation summary; it writes no result files.

## Established baseline state

The shell-safety rebuild is separately checkpointed at
`88c9d6a7ebbbe2cd3fbacfe2754de09a1f4e002d`, with reviewed tree
`c9cb3aa2f40e60e0a0c1b22323a7149fda600967`. Its 132 selected controls and real
98,305-byte READY-gated PTY test passed; those are not full native-session tests.

An existing local offline checker environment was verified against the public lock
without installation: Node v24.22.1 and Pyright 1.1.414, including the exact bundle
hash. Eight offline-checker controls passed with no errors or skips. This does not
verify all installed Node dependencies or complete campaign execution.

Full admission still requires seven intentionally excluded private files. It also
unconditionally requires the optional hotpath checkout even for a direct-only
baseline. Those gates have not been removed or weakened by this preflight.

## What still prevents actor runs

- Relevant private grading/reference material must be absent from the shared
  worker filesystem, with its backup verified before any authorized removal.
- Canary handling and the retrievable transcript/tool-log scope must be established.
  Relay logs are partial; absence of a canary is not proof that no outside read occurred.
- Existing post-run grading executes candidate Python as the same OS user as the
  restored private grader. Ending the actor does not put grader files outside that
  code's reach. This does not satisfy the requested grading boundary.

Native comparisons, if later allowed, are screening only, not evidence that an idea
beats baseline. Promising ideas can be listed for later isolated confirmation.

## Decision required before graded screening

No decision is needed to preserve the pause. Graded screening requires either an
already available, authorized grading boundary outside submitted code's reach, or
an explicit change to that requirement. No new isolated runner is being built.
An ungraded public-only rehearsal would be a different, narrower outcome requiring
explicit authorization; it would not establish full-task success or comparative
performance. Public preparation can be verified while those decisions remain open.

## Verification

Final selected combined suite: **140 tests passed, zero failures/cancellations/skips**.
This includes the existing 132 shell-safety/protocol/controller/launcher controls
plus eight public-preflight controls. Independent review passed 54 helper/launcher
contract tests plus additional synthetic path/link/size controls and found no
remaining blocker within the preparation-only scope. This is not the complete
repository/native suite.

Three preparation-evidence gaps were reproduced and fixed before publication:
repository-wide Git status could touch private paths or invoke filters; selecting
only observed fixture files could omit a missing committed file; and an inherited
inventory edge case could omit a literal __proto__ filename. The preflight now
uses Git object reads only, selects complete committed fixture workspaces, and
rejects the reserved-key case locally. It does not change shared inventory behavior.

Coordinator, supervisor, actor-data capture and full grading gate source remain
byte-for-byte unchanged from the shell-safety checkpoint. The reviewed preflight
helper SHA256 is 7a9a7f94d19d0e955d1f1e26a3764245c0fa89450c6a78c7c56679a499f593cc.
