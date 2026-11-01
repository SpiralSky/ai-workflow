# All-provider host broker — 2026-11-01

## Branch and authority

- Branch/worktree: `dot/all-provider-host-broker-20261101` / `repos/ai-workflow-hostbroker`.
- Exact base: `179ac10803e579dd7e696b7699ed57d3199331b1` (latest composed source), not the older provenance branch.
- User requires avoiding credential exposure and permits reversible isolated experimental development. Draft plan created via Specplane CLI; no plan/spec approval, finalization or merge was performed. Parent owns publication and real CI.

## Correction and preserved treatment

The old runner passed an API key and endpoint through `docker exec` arguments and enabled bridge egress for OpenRouter orchestration. No actual keys were used here, but this blocked safe live evaluation.

- `frameworkLaunch` no longer accepts credentials and always selects `--executor-provider host` for orchestrate, including bracketed variants. Job containers use network none, without provider environment variables. The host broker pins the configured secondary model and host client; peers cannot select provider, endpoint, credentials, temperature, token caps or other generation overrides.
- The Docker MCP subprocess descriptor uses only an explicit platform/Docker-client connection allowlist (PATH/HOME/user/temp/Windows paths and Docker connection/context/config paths). Provider API keys/endpoints, arbitrary secrets and arbitrary optional environment overrides are not copied. These remain host Docker connectivity settings, not task-container environment injection; no system configuration was changed.
- OpenRouter remains the default provider. Existing server construction omitted secondary temperature and all other generation overrides; the broker preserves this provider-default omission rather than guessing a value. The same host Chat Completions client uses the same configured endpoint/key and 300-second timeout. Main temperature remains supplied only on main requests. No fallback provider or new credential scope was added.
- Closed-until-persisted-attestation admission, request-ID replay prevention, cancellation and fail-fast remain intact. Reverse responses retain observed cost/cache usage and are still emitted once per turn by server telemetry; the host broker does not add a duplicate turn.
- Main API errors previously copied raw response/transport diagnostics into thrown errors. They now retain classified kind/status with generic safe messages; no raw response body, endpoint, token or abort reason is exposed. The broker now forwards only strict allowlisted error kind and numeric HTTP status, preserving context-limit/infra/other classification without forwarding messages, causes or headers.

## Offline evidence

- **224 runner+LLM source tests passed**, zero failures/skips (`/tmp/aiw-all-provider-final-source.log`); root typecheck passed.
- Real in-memory MCP + real orchestrate engine + mocked OpenRouter HTTP completes main, selection and two executor calls. Synthetic costs 1 + 2 + 3 + 4 total 10 exactly once, with cached-token and cache-hit telemetry preserved. These are test fixtures, not measured spend.
- Sentinel key/endpoint absent from launch args/descriptors/container metadata and serialized workflow artifacts. Six main error paths (JSON, non-JSON, HTTP200 error, empty response, network exception and context-limit) retain no sentinel in main-loop artifacts.
- Raw peer provider/model/endpoint/generation overrides reject without dispatch. Mocked OpenRouter HTTP cancellation aborts the pending request with no retry; existing early-initialize/tools-list admission and replay tests also pass.
- No real provider requests, auth/credential reads, Docker containers, network changes, paid evaluation or remote publication occurred. Fixtures use injected command/fetch boundaries; they are not live/Docker proof.

## Limits and handoff

Budget enforcement is still per attempt, **not a hard dollar cap**. Multiple nested/in-flight requests can incur charges before cancellation; cancellation cannot reverse billing. Successful mocking establishes protocol/accounting behavior, not full benchmark success or a measured cost reduction.

`packages/llm/src/client.ts` is also included in standalone server compatibility code, so the final composite artifact must be rebuilt after review and then fully validated. No stale-artifact full pass is claimed here. Parent coordinates the full-suite lane and any real CI; independent security-review outcome will be appended before handoff.

Independent security review reproduced **24/24** focused broker/OpenRouter tests and reported no remaining blocker for this credential-boundary correction after the strict error-kind/status preservation fix. Final **224 runner+LLM tests passed**, zero failures/skips; typecheck, Specplane validation (zero errors) and diff-check passed. The final full composed artifact/native/Docker validation remains pending with the parent, and live spending remains unauthorized.
