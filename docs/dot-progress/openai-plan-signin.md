# OpenAI sign-in development record

## Status and branch

Experimental implementation on `dot/openai-plan-signin-20261101`, based on fail-fast campaign commit `1e133031b939d91d50b4502f8f624f506a15ef21`. Worktree `repos/ai-workflow-openai-signin`. Plan `2026-11-01-openai-plan-signin` remains **draft**, not approved or finalized. Final merge is exclusively human-controlled.

## Autonomous decisions (not approvals)

- Implement the documented public Sign in with ChatGPT plan-usage OAuth flow, not extraction of Codex/private session tokens or an unrelated website identity login.
- Retain the current OpenRouter-compatible backend by default. `--provider chatgpt --usage-mode subscription` selects both main and secondary agents; mixed-provider paid fallback is forbidden.
- Run all ChatGPT provider traffic on the host. Secondary requests use opt-in reverse MCP over the existing stdio channel. OAuth tokens/refresh tokens never enter problem containers, benchmark input, model prompts or process arguments. ChatGPT containers retain network isolation (`none`).
- Use fixed public OpenAI endpoints with redirects rejected, authenticated model discovery, verified OIDC issuer/audience/signature/expiry/nonce and required granted scopes. Account/client registrations stay separate. No login occurs automatically during a run.
- Use owner-only app storage with atomic writes, ancestor/symlink checks and cross-process refresh locks. Optional retained ID-token login hints are deliberately omitted to avoid exposing an ID token to browser-launch arguments. Signout keeps account mapping and attempts remote revocation before clearing tokens.
- Require explicit maximum calls, observed-token threshold and elapsed duration, and one campaign worker. The shared host gate serializes and reserves all-role requests before dispatch. No automatic retries. Tokens are usage proxies, not dollars or a query of remaining weekly allowance. Missing monetary costs remain null; unrelated malformed/missing telemetry still fails closed.
- The preview rejects `max_output_tokens`: a completed response can overshoot the observed-token threshold. Duration cancellation is best effort and cannot undo allowance use. Cache counters are included only when reported; reported-call counts identify partial sums.
- MCP SDK cancellation of numeric request ID zero was found ineffective in a mock. A UUID-keyed cancellation notification preserves first-request cancellation without modifying installed dependencies.

## Verification

Only offline mocks and source-based diagnostics are authorized and used here. Focused auth, Responses, main workflow, broker, quota and compatibility tests are recorded in the final handoff. No real OAuth client was registered, browser sign-in performed, auth store read, account grant created, provider inference requested, or paid evaluation run.

## Unverified / limitations

- Live loopback/browser sign-in and account eligibility are unverified; sandbox sockets are unavailable. Linux/macOS browser launcher is implemented; Windows fails explicitly. Use your own eligible local environment for user-authorized sign-in. Hosted app eligibility and credential transfer to a VM are separate questions; no CI OAuth/secrets setup is performed.
- The allowance is shared with the signed-in account's other ChatGPT/Codex use, not free independent credits. Plan/account availability and limits are controlled by OpenAI; this code cannot guarantee a model or remaining quota.
- Stop a running campaign before signout. Local signout cannot guarantee immediate cancellation of another process's in-flight access-token request. Aborted rotating refresh can require re-sign-in; stale locks require explicit inspection, never automatic unsafe unlock.
- Docker end-to-end, live model task success and monetary/allowance efficiency have not been measured by this implementation. Offline passing fixtures are not a live benchmark success claim.
- No candidate cost reduction is claimed. Full required benchmark task completion remains the acceptance objective; fail-fast preserves failed/incomplete campaigns for diagnosis.

## Official contract consulted

- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/website
- https://developers.openai.com/api/docs/guides/reasoning

## Final local evidence

- `node scripts/test-cloud.mjs` with the pre-existing verified tool venv: **465 Node + 59 Python tests**, zero fail/skip; typecheck, frozen matrix, 13 broken variants and 65 trusted reference diagnostics pass.
- `node packages/server/build.mjs`: pass; tracked server artifact synchronized to source (including inherited fail-fast changes).
- Framework validation: zero errors, 257 inherited advisory warnings; no approvals/status promotions.
- CLI help and whitespace checks pass. First incremental commit: `1540999` (auth/provider). Integration commit is recorded in Git history.

## Parent integration dependency

A separate runtime audit discovered that the inherited server ignored the runner's `--engine isolated-vm` flag and defaulted to QuickJS. The dedicated runtime-coherence branch is implementing explicit engine selection and bundle freshness checks. Integrate that work and regenerate the server bundle before claiming Docker/native-engine provenance. This branch's representative orchestrate test intentionally uses QuickJS; it is not evidence of native-engine execution.
