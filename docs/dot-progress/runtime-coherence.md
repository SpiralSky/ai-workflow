# Runtime coherence audit — experimental, unmerged

- Branch: `dot/runtime-coherence-20261101`; base migration `75ab542c626bc7276d2ee9575956899c79b6d75d`.
- No approval, plan finalization, or merge is implied. Autonomous decision: verify the artifact actually mounted by runner, not only source imports.
- Rebuilt `packages/server/dist/aiw-server.mjs` from this exact checkout using locked dependencies installed locally with lifecycle scripts disabled.
- Added deterministic `node packages/server/build.mjs --check`: temporary source rebuild, exact bundle/prompt bytes and inventory comparison; does not overwrite tracked artifacts. Fixed build working directory to repository root so root/workspace invocation yields identical output.
- Added normal server-package tests for freshness and actual packaged runtime rejection of an unsupported framework variant before MCP startup.
- Native external dependencies are deliberately excluded from byte freshness: they are platform-specific and untracked. This check does not assert native-module availability, Docker isolation, or live-model correctness.

## Launch mismatch requiring correction before paid evaluation

`packages/runner/src/job.ts` requests `--engine isolated-vm`; `config.ts` records that engine in provenance. The server CLI currently accepts unknown arguments (`strict:false`), does not recognize engine, and does not supply `BuildOptions.runtime`, so both branch and executor use QuickJS. Existing `selectRuntime` can enforce explicit native selection and fail when unavailable; core already threads the runtime through both paths. Reported to parent and auth implementer before engine changes. Never interpret source/mock tests as evidence of isolated-vm execution.

## Validation and integration

Focused packaged tests: 2 passed, no skips. Full package/typecheck results are recorded below after execution. Stock npm test is attempted but its tsx IPC wrapper is incompatible with this sandbox; use the same test files under the supported Node loader.

The historical migration preservation inventory intentionally freezes its runtime baseline; post-migration changes require explicit integration provenance rather than silently rewriting or weakening that evidence. The portable wrapper's migration check is not claimed passed for this experimental development branch.

Validation result: all 386 package tests passed (171 core, 7 llm, 81 runner, 9 server, 16 telemetry, 101 tools, 1 viewer), zero failures/skips; root TypeScript check passed. `npm test` failed due to tsx's EPERM IPC listener in this restricted runtime; the identical files passed with `node --import tsx --test`. Freshness checks passed from repository root and server workspace.

## Bounded engine correction

Parent authorized the bounded fix after the mismatch report. CLI now recognizes and validates `--engine quickjs|isolated-vm|auto`, calls existing `selectRuntime` before host/MCP startup, and passes the selected runtime into `startServer` and `buildFramework`. Core already threads that option to both branch and orchestrate executor. Explicit unavailable `isolated-vm` throws; no silent downgrade. Omitted engine preserves QuickJS. Explicit `auto` retains the core's documented availability fallback and prints its reason; runner still explicitly requests isolated-vm, never auto. Actual selected engine is printed to stderr, leaving MCP stdout clean. Successful runner startup therefore matches its existing isolated-vm provenance; historical runs remain suspect and are not relabeled.

New tests cover invalid engine, deterministic unavailable native prerequisite, real packaged QuickJS branch execution, and injected runtime failure proving server forwarding instead of accidental default execution. One initial fixture failed because it referenced `state` without declaring the branch argument; corrected fixture signature, rerun passed. No implementation assertion was weakened.

Limitations: native execution has not been validated here. `--host fallback`, arbitrary unknown CLI flags, and parsed-but-unwired transcript/blob options remain older independent gaps; this correction does not silently implement or claim those capabilities. Before paid experiments, require actual Docker/native execution evidence and matching regenerated bundle after composing with authentication changes.

Final engine-change validation: all 390 package tests passed (171 core, 7 llm, 81 runner, 13 server, 16 telemetry, 101 tools, 1 viewer), zero skips/failures; root TypeScript check passed. Deterministic freshness negative control deliberately appended a bundle comment, correctly failed `--check`, restored exact original bytes, and passed again. Specplane validate returned valid=true, no errors; imported feature-detail and existing legacy Claude-instruction freshness warnings remain unchanged.

`runtime-development-allowance.json` records exact before/after hashes and modes for all five changed runtime paths, based on migration75ab542. It is an explicit integration proposal, not a fabricated approved plan or replacement historical inventory. Recompute final artifact hashes after composing auth/source changes; preserve both the historical baseline and the new development provenance.
