# Bounded provenance and ignore integration

Development only, no approval/merge/live model activity. Base packaging/lifecycle snapshot:
`e390676afddf74fb7ef7ca39f4be9c9f7fe1aefd`.

- Ignore audit source `f54d21e569104bae236e16575b1bca608dbb479a` replayed as
  `dc236e6`: three exact metadata paths (`.gitignore`, `scripts/check-gitignore.sh`, audit doc)
  are hashed in the explicit development allowance, without rewriting original inventories.
  `sh scripts/check-gitignore.sh` passes; intentional portable runtime resources remain tracked.
- Provenance source `b40c341094812b7a10f3b933da5886cbc9efd357` replayed as
  `0728041`: grade conflict retains `problemImageRef` for legacy callers and prefers a validated
  observed immutable image ID for new runs. An added test rejects mutable override references.
- Server artifact rebuilt from composed final source. Original auth broker and graceful sidecar
  cleanup preserved. Source-only worker validation is not mistaken for artifact validation here.
- New provenance plan remains draft; generated plan index regenerated through pinned Specplane.
- Original source/runtime inventories, imported spec bodies/history and permissions unchanged.
  Explicit runtime deltas now88, plus three narrowly enumerated ignore-audit metadata files.

## Intermediate verification

Configured suite520 package +22 script tests, zero failures/skips; root typecheck passed.
Focused provenance/image tests48 passed; actual enhanced framework checker and bundle freshness
passed. Logs: `/tmp/signin-provenance-{full,focused,preservation}.log` and
`/tmp/signin-provenance-framework.json`.

## Security follow-up (not closed by the passing suite)

Reviewer found no metadata credential/hidden-check-content exposure, but identified that the
secondary model broker is installed during MCP connection before provenance validation/persistence.
Current trusted server does not issue early requests, but enforcement must reject any early peer
request rather than rely on that behavior. A closed admission gate + mock peer regression has been
requested from the provenance worker. Do not publish this intermediate state as enforcing
pre-model attestation until that fix is integrated and reviewed.

No live OAuth, provider/model requests, Docker target probe, credential setup, publication,
approval or merge was performed. Actual Node22 target-container probe remains parent's Actions task.

## Security follow-up resolved

Gate fix source `8ef70b782fc8e1ae5f2706e5d150d2b5ef6a0e3d` cleanly replayed as
`eb95315ad698b0b94058408c64b5aaa62cac7f80`. Reverse inference admission remains closed through
MCP initialization/tools discovery and until static/runtime verification plus awaited persistence
succeed; early requests fail immediately, never queue or consume allowance. Cancellation,
setup failure, session close and loop cleanup permanently revoke admission. The explicit allowance
retains the previous intermediate hashes and records this transition separately.

Reviewer verified final imported source/tests byte-identical to the reviewed fix, bundle freshness,
and reran14 broker/orchestrate tests:14 passed, no remaining bounded privacy/provenance blocker.
No credential or hidden-check bodies are added to metadata. The actual observed candidate image ID
is now used for grading; source image-build identity is not substituted for that observation.
No immutable provider-model version is guessed: requested selectors and returned observations differ.

Final focused packaged native/tierL + actual graceful descendant lifecycle + broker/orchestrate
regressions:18 passed. Ignore hygiene and actual enhanced-framework checker passed88 runtime deltas
plus three metadata hashes; generated source/bundle freshness passed. These are offline results,
not target Node22 Docker or live model success. Source and imported plan approval statuses unchanged.

Final configured suite after admission-gate integration:522 package tests +22 script tests,
zero failures/skips and root typecheck passed (`/tmp/signin-final-gate-full.log`). Focused and
framework logs: `/tmp/signin-final-gate-focused.log`, `/tmp/signin-final-gate-framework.json`.
