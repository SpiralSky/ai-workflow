# Truthful evaluation provenance — 2026-11-01

## Branch and authority

- `dot/provenance-readiness-20261101`, worktree `repos/ai-workflow-provenance`, based on exact `7caf329`.
- Isolated experimental development follows the user's explicit development-approval exception. Plan `2026-11-01-provenance-readiness` was created through the pinned Specplane CLI and stays **draft**; no specification, plan, decision or PR approvals/finalization/merge were performed.
- Parent owns composite integration/publication. No remote writes, auth operations, API/model calls, real Docker runs or spending occurred.

## Implemented evidence, not requested placeholders

1. Missing git identity/base prompt is an error, not `(unknown)`, a fabricated `dirty: false`, or a hash of `(missing)`.
2. Before account discovery, the CLI checks portable bundle freshness and fingerprints declared tracked runtime sources, package/lock manifests, the complete mounted artifact tree including copied native dependencies, selected task folders and configuration. Source selection covers `src`, `prompts`, `python`, `fixtures`, `package.json` and `build.mjs` under the six runtime packages. Generated/dependency/cache files are excluded from source scope and mounted dependencies are instead included in bundle scope. Untracked runtime inputs must be staged/committed; arbitrary untracked files and credential stores are not scanned.
3. Task-folder hashing covers actual workspace, prompt, task metadata and hidden checks, excluding `reference/`, generated `.selfcheck.json`/`.dockerignore`, Python cache artifacts. Only hashes and declared limits appear in provenance; check contents never enter prompts/logs.
4. Actual MCP tools/list replies expose metadata derived from the selected runtime object, executed entrypoint bytes, loaded hidden prompts, real host catalog and effective settings. The runner compares entrypoint/prompt hashes to the mounted bundle, accepts only the actual native engine requested by this runner, and records Node version/platform/ABI. No requested engine string is used as evidence.
5. Each job records the immutable `.Image` ID reported by its actual running container before its first model request. Grading is pinned to that observed ID. Existing direct three-argument grading callers retain their legacy fallback; this does not claim every external caller is pinned.
6. Runtime maps begin explicitly **pending**. Observations must persist before model work, and repeated jobs must agree on image, framework schema/instructions, hidden prompts, catalog, settings and runtime. Source/config/bundle/problem drift is checked before model work and before/after grading. Complete status requires every selected image/framework observation, including for injected attempts; mocks do not bypass the finalization gate.
7. Report comparison rejects mixed attested/unattested runs and mismatched new input fingerprints. Legacy reports remain inspectable but are explicitly labeled `legacy-unattested` / “not a verified baseline”; they are not silently upgraded.
8. Turn telemetry retains `model` as the requested identifier and adds `providerModel` / `providerSystemFingerprint` only when present in the response. An absent observation stays absent. These opaque provider strings do not establish exact weight identity or guarantee alias stability.

## Autonomous choices and remaining limits

- Observe actual job servers instead of starting throwaway framework containers; no throwaway model calls. A run with unobserved selected cells remains incomplete.
- Local MCP metadata is **unauthenticated self-report** from trusted local code, matched to a read-only mounted bundle; this is not cryptographic/adversarial attestation. Files are assumed stable during operations; ordinary drift is detected, hostile mutate-and-restore races are not.
- `wallClockMs` preserves the declared limit while `integrity.wallClockEnforced: false` exposes the pre-existing enforcement gap. Unsupported nondefault branch timeout/trace limits fail closed. Branch context is now explicitly forwarded rather than silently using the server default.
- Effective server settings are retained readably as `observedSettings`. A null secondary temperature means the server did not supply it (or there is no executor), **not** a measured numeric provider default; this patch does not invent that missing observation or change sampling policy.
- Configuration hashing covers declared nonsecret run configuration only, never raw executor launch arguments, API keys, account tokens or credential files. Provider model observations remain per-turn; no exact-weight inventory or price estimation is claimed.
- Fingerprints identify bytes/settings, not benchmark quality, provider settlement or task success. Existing cost/budget limitations remain unchanged.

## Validation and exact outstanding action

Supported loader source tests and typecheck were used; no known-stale full artifact pass was attempted or represented as passing. The normal `tsx` CLI wrapper has the previously documented Unix-IPC restriction, and the parent explicitly requested not wasting a known-failing full run while the runtime worker owns that lane.

- Focused preflight/attestation/schema/grading tests cover missing/static evidence, source/native/check drift, excluded reference/bookkeeping, symlink rejection, hash boundaries, unknown engines/missing prompt maps/wrong bundle/catalog/settings, immutable-image grading using a fake Docker executable, pending finalization, credential-scope exclusion, and opaque model observations.
- Actual local stdio server test verifies observed default QuickJS, loaded prompt/catalog fingerprints, executed entry hash and Node ABI. This is not native/Docker validation.
- Source-only command: `node --import tsx --test packages/runner/test/*.test.ts packages/telemetry/test/*.test.ts packages/server/test/telemetry-session.test.ts`.
- Root `npm run typecheck`: passed.
- Final source-test count/log and Specplane validation recorded below after final execution.

**Outstanding integration action:** replay into the current composed branch, preserve its newer `problemImageRef` fallback while applying grade.ts's optional immutable-ID preference, rebuild the shared server bundle **after all source changes**, then run artifact freshness and the authoritative full configured suite. This branch intentionally does not modify generated assets; its changed server/telemetry source makes the inherited artifact stale. No full-suite/native/Docker/live-model completion is claimed.

Final source snapshot: **151 tests passed, 0 failed, 0 skipped**, log `/tmp/aiw-provenance-final-source2.log`. Root typecheck passed. Specplane validation reports valid=true with zero errors (existing prose warnings remain). `git diff --check` passed. Full composed/bundled validation remains explicitly pending as described above.

## Review follow-up: pre-attestation reverse-model admission

Independent internal security review found that installing the host broker before MCP initialization exposed a live secondary client before runtime verification. This is now closed by default: initialization/tools-list requests receive an immediate denial, are never queued, and consume no allowance. `runJobAttempt` awaits provenance persistence, checks cancellation, then opens session-local admission immediately before model-loop work. Loop exit, campaign cancellation, connection failure and session cleanup permanently revoke admission; active broker work is aborted through the existing combined signal.

`onProvenance` now permits a promise and is awaited, so asynchronous persistence cannot race admission. Adversarial socket-free MCP fixtures request reverse inference during both initialize and tools/list: zero underlying calls and zero bounded allowance calls, followed by one explicitly admitted call, then rejection after revocation. No live authentication, model request or real Docker operation was involved.

Validation: **134 runner tests passed, zero failures/skips** (`/tmp/aiw-admission-runner.log`); typecheck passed. Independent security reviewer reproduced14 broker/orchestrate tests and reported the pre-attestation finding fixed with no new blocker. This is a technical review, not a user approval or plan finalization. Composite integration/full validation remains the parent's responsibility; no publishing or generated-asset changes were performed here.
