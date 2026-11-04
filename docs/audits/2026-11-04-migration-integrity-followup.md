# Migration integrity follow-up — 2026-11-04

## Scope and exact base

This isolated follow-up starts at published PR #1 head
`be2500de70b9b29b0a97ee03a4561b47df4f5a30`, tree
`949995e5d1535a5b37eca9012bec36d51cd35da4`. The GitHub commit metadata and
local Git object hashes agree. No specification, plan, decision approval, merge,
repository permission, or authentication state changes are included.

## Reproduced defects

1. The runner executes `packages/server/dist/aiw-server.mjs`, but that tracked
   distribution still contained the old implementation. Two offline MCP tool
   calls produced the same `s:1` event ID and null parent twice. The corrected
   source produced `s:1` under `r:1`, then `s:2` under `r:2`. The old bundle also
   silently ignored treatment keys that the source parser validates.
2. An executor can catch a failed selection-model request inside `findTools`,
   then finish its outer `do` successfully. The outer success concealed the
   request's unknown charge. A scripted fixture with two main turns and two
   secondary turns at $1 each, plus one failed selection request, returned a
   complete `$4` total with no uncertainty. The valid result is a known `$4`
   lower bound and an unknown total.

## Focused corrections

- `wrapLLM` writes a `llm.cost-incomplete` attachment when the client rejects,
  then rethrows the original rejection. It writes no invented usage/turn and
  includes only model and role, not request text, credentials, or error payloads.
  The catch covers the client request only, not subsequent logging failures.
- Attempt accounting and telemetry rollups honor that marker as uncertainty.
  Attachments never add charges or tokens; successful turn events still supply
  the known lower bound. Ordinary failed non-model tools do not create it.
- Regenerated the tracked server distribution from the current source. Tests
  exercise both source and shipped bundle for unique parent-linked IDs, strict
  variant rejection, and recovered nested selection failure. Scripted fetch
  replaces the network boundary before either server loads.

## Preservation and approval boundaries

Both original migration inventories are byte-for-byte unchanged. The original
19 specification bodies, six historical records, imported `review` statuses,
and draft migration plan are unchanged.

`.specplane/migration-followup-allowances.json` records eight existing runtime
paths, with exact before/after SHA256 values and unchanged modes. The manifest
pins this ledger's SHA256. Each before hash must match the original runtime
inventory, and each after hash must match the worktree. Additions, unsafe or
duplicate paths, mode changes, redundant entries, unrelated file edits, and
unrecorded tampering remain rejected. The separate viewer-test allowance is
unchanged. When available, historical objects also verify the follow-up's
before hashes against the published base; fresh snapshots still enforce the
self-contained inventories and allowances.

## Verification

- Configured `node scripts/test-cloud.mjs`: **412 tests passed**, including
  397 package tests and 15 workflow/preservation tests; zero failures/skips;
  root typecheck passed. The Python tool venv was explicitly provided.
- Independent focused review: 59 tests passed, zero failures/skips; typecheck
  and whitespace checks passed. The regenerated bundle exactly matched an
  independent in-memory build. Extra failure-identity, repeated-failure, and
  catch-boundary checks passed.
- Enhanced Specplane migration validation passed, including historical source,
  runtime, and follow-up checks. Draft `plan next` remains action `none`, with
  no checkout. Existing 255 architecture-leak warnings and one freshness warning
  remain unchanged.
- Ignore hygiene and `git diff --check` passed.
- Standard root `npm test` was attempted. The six workspace `tsx` CLI wrappers
  remain blocked by the environment's Unix-domain IPC restriction (`EPERM`);
  the viewer's Node-loader test passed. This is not a standard npm-wrapper pass.
  The configured cloud command ran the same workspace test files successfully.

No live provider calls, paid evaluations, Docker-backed checks, native-engine
validation, remote CI, or benchmark success/cost savings are claimed. Monetary
budget checks remain attempt-boundary checks, not strict per-turn enforcement.
