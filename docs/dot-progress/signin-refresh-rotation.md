# Refresh rotation cancellation repair

## Scope

Independent offline review of draft PR #2, exact source commit
`5d170bdc9560c01ff19a8b9d0e062fb46b4b8a2e`, tree
`e42cade73d0034f647d6848364d5da9e4741a859`, identified a lost-replacement window.
The token endpoint could successfully rotate a refresh token, followed by a JWKS
outage or inference cancellation that prevented saving its replacement. Two
offline injected-transport cases reproduced retention and reuse of the old token.
No live account sign-in, credential lookup, model call, or paid request was made.

The isolated repair fetches verification keys before consuming the refresh token.
Cancellation still applies before dispatch. After dispatch, the existing bounded
token transport, signature/account validation, and atomic owner-only write finish
under the same cross-process lock before caller cancellation is propagated. No
inference token is returned to a cancelled caller. No retry or billing fallback
is introduced, and sign-in cancellation behavior is unchanged.

## Limits and review

This is not a general recovery protocol for uncertain token exchange or disk
failure. A timeout after server acceptance, process termination, unavailable
storage, or a signing-key change between preflight and exchange may still require
deliberate reauthorization. Invalid identity, signature, grant, or replacement
data never becomes active. Keys are not fetched again after consuming a token.

The official contract requires retaining the latest replacement and serializing
refreshes: <https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions>.
Terminal refresh reuse/invalidation errors require reauthorization:
<https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery>.

Existing imported specifications and approval evidence are unchanged. The original
experimental sign-in exception remains recorded in
`plans/2026-11-01-openai-plan-signin/spec-gaps.md`. This repair does not approve a
specification, promote a plan, approve a pull request, merge, or publish a branch.

## Validation

- 29 focused authentication/refresh tests passed, including 11 new regressions.
- The documented `scripts/test-cloud.mjs` entry passed all 548 package tests plus
  23 script/preservation tests, with zero failures or skips, then typechecking.
- Server bundle freshness, runtime ignore hygiene, and whitespace checks passed.
  The tracked server bundle and portable resources are byte-identical to the base.
- Independent read-only code review found no blocking issues. This is not a PR
  approval. Tests use injected transports and temporary mock credentials only.
- `npm test` was attempted first and hit the sandbox's existing `tsx` IPC socket
  `listen EPERM`. The documented cloud entry runs the same test-file inventory
  without that optional IPC listener. Its first run also exposed the recovered
  checkout's absent ignored native dependency closure; the documented server
  build restored it, changed no tracked artifact bytes, and the complete rerun
  passed. No assertions, tests, or repository test configuration were weakened.
- Execution used Node 24.22.1 and the existing verified Python test environment.
  This is not a Node 22 Docker rerun or a live OAuth/model compatibility claim.
