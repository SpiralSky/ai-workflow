# Packaged runtime readiness — experimental audit

Branch `dot/runtime-packaging-readiness-20261101`, based on runtime correction `036443f193aa9fa9a9deccf568746d4cc5ee0670`. No plan approval/finalization, production changes, paid requests, credentials, or remote publishing.

## Confirmed by isolated artifact probes

Copied `packages/server/dist` beneath a fresh `/tmp/aiw-relocated-audit-*` directory, away from repository ancestor `node_modules`. Launched the actual bundled MCP server and requested ordinary fixture tools; removed the temporary test copy afterward.

| Probe | Observed result |
| --- | --- |
| Node24.22.1 `--no-node-snapshot`, `--engine isolated-vm` | Startup exits1: `Cannot find module 'node-gyp-build'` |
| QuickJS baseline tierL `outline` on a tiny Python file | `isError:true`, `no sidecar` |
| QuickJS baseline tierL `diff` | `isError:true`, `no snapshot` |
| QuickJS baseline tierL `issues` fixture search | `isError:true`, ENOENT `/fixtures/external/issues.json` |

The native loader dependency is declared by locked isolated-vm6.2.0 and required by its `isolated-vm.js`; build copies only isolated-vm and typescript-api. Source-tree testing can mask the omission via ancestor dependency resolution. In a second temporary copy, adding the existing pinned node-gyp-build package allowed actual isolated-vm MCP branch execution (`async () => 42` returned42); stderr confirmed `engine=isolated-vm`. This is Node24 ABI137 evidence, not Node22/container evidence.

## Native ABI hypothesis refined

The package ships linux-x64 glibc prebuilds for both ABI137(Node24) and ABI127(Node22). Copying from a Node24 dependency installation therefore does not inherently imply an ABI mismatch. Native loader transitive dependency omission is confirmed; Node22.15.0 actual loading still needs Docker CI. A future source-built `build/Release` artifact can be preferred by node-gyp-build, so runtime artifact preparation must explicitly avoid accidental foreign-ABI binaries or verify loading under target Node before evaluation.

## Source-confirmed packaging gaps

- CLI supplies only `{root}` to LocalHost. It does not create Sidecar or pristine snapshot; catalog advertises tierL tools that consequently fail. `tool-catalog` §§3–4 require one sidecar/session and startup snapshot.
- Build includes neither `packages/tools/python` nor `packages/tools/fixtures/external`. Their current source-relative URLs escape bundled location. After sidecar wiring, its `../python` would resolve outside dist unless relocated.
- Base image installs Python3.12, git, curl, xz and Node22.15.0, but not `/opt/aiw/venv`, pinned analysis requirements, ripgrep, or Node PATH for pyright. `tool-catalog` §6 specifies these dependencies.

## Minimal corrective scope proposed

1. Package the existing pinned native loader dependency plus Python source and shared external fixture data; map source-relative URLs into the read-only bundle. Include source/data assets in deterministic freshness checks.
2. At tierL server startup create existing Sidecar and takeSnapshot primitives; close/dispose them on server shutdown/start failure. Do not substitute reduced tools, silently fallback, or hide unsupported capabilities.
3. Prepare image venv from the existing pinned requirements, install ripgrep and expose installed Node to pyright. Preserve build-context consistency: current image build context is `experiments/docker/aiw-base`, which cannot directly COPY repository-level requirements.
4. Before model runs, run a relocated artifact test and a Node22/container MCP preflight covering native branch execution, tierL outline, snapshot diff/restore, static check and external fixture access. A failure must halt the campaign before any model call. No paid run is justified by source tests alone.

Pending: scoped implementation and real target-container verification; no readiness claim yet.

## Corrective implementation (still unmerged)

- Build now copies the installed runtime dependency closure (including node-gyp-build), canonical Python sources/requirements and shared external JSON fixtures. Resource URLs are patched into bundle-relative paths; portable asset freshness covers the new files. Isolated-vm's host `build/` is excluded, so ABI-tagged package prebuilds determine loading; unsupported target platforms fail rather than silently using a different engine.
- CLI creates tierL hosts through existing Sidecar/takeSnapshot primitives. Verified catalog: tierS has six tools and no snapshot/sidecar consumers; tierL has all consumers. Owned resources close on MCP close, stdin EOF, startup failure and termination signals. Caller-injected LocalHost resources remain caller-owned.
- Added relocated packaged-runtime regression: actual native startup and branch execution; tierL outline, pyright/ruff check, fixture access, diff and restore. A fresh temporary root prevents ancestor repository dependency/resource resolution; no credentials, models, or network endpoints are used.
- Test image installs ripgrep and an isolated tool venv using the single canonical requirements file, plus Node PATH for pyright. **Build context changed to repository root.** Do not retain the old `docker build experiments/docker/aiw-base` invocation.
- `scripts/test-packaged-docker.sh` rebuilds/checks artifacts, builds that image with canonical context, then runs the same packaged MCP regression under container Node22.15.0 with `--network none`, only server/dependency mounts, no credential forwarding. Its failure halts immediately; it does not run a model or benchmark. Docker is unavailable locally, so this script remains unexecuted until parent-authorized CI.

Validation: 391 package tests passed, zero skips/failures, and root TypeScript check passed. After final resource-path guard/test-fixture tightening, all14 server tests and typecheck passed again. The relocated test proved actual isolated-vm branch return42 on Node24 ABI137 and required tierL calls using Python3.12 verified venv. Shell syntax check passed for the Docker preflight. Native Node22/container checks remain **not run**, and are the remaining target-readiness gate; no model success/cost is claimed.

Build-context hardening: Dockerfile-specific ignore rules whitelist only the Dockerfile and canonical requirements path when using repository-root context. Host node_modules, repository history, unrelated worktrees and credential files are excluded from the build context; the later explicit runtime/test mounts remain read-only and separate. Docker applies these rules during the pending CI build; not locally verified without Docker.

## Shutdown descendant correction (separate experimental follow-up)

Review correctly found that the earlier Sidecar.close killed only its Python parent, leaving execution.py's separate workspace process group running. Correction: give each sidecar its own process group; close requests cooperative termination and awaits its bounded reap; Python session shutdown (TERM/EOF) sets a non-resettable shutdown flag, cancels/reaps active workspace child groups, and stops queued work. Checker subprocesses share the sidecar group. LocalHost awaits this cleanup before CLI termination. The owned-group escalation is bounded to2seconds and never scans or kills unrelated process trees. Execution group cleanup is idempotent so finally paths do not re-signal an already-reaped group.

Focused regressions launch a real workspace child and grandchild. Direct Sidecar.close, bundled CLI stdinEOF (exit0), and CLI SIGTERM (exit143) all stop both descendants. This covers ordinary inherited process groups, not malicious processes that deliberately create independent sessions or an externally SIGKILLed server/sidecar; Docker lifecycle isolation remains required. No security-boundary or complete arbitrary-process containment claim is made.

Initial full package run passed394 tests and typecheck, but its final freshness check correctly caught a Python cleanup refinement not yet regenerated into dist. Regenerated the artifact and reran focused lifecycle tests; final frozen-source validation is recorded after rerun, rather than counting that stale-artifact run as ready.

Final shutdown validation: all394 package tests, zero skips/failures; root typecheck and exact bundle/resource freshness passed. Independent security reviewer reran the3 focused lifecycle tests successfully. Added bounded test cleanup/startup failure handling, then reran all17 server tests plus typecheck/freshness successfully. Snapshot disposal uses finally even if sidecar termination reports an error. The process-group shutdown evidence is POSIX/Linux-specific; no Windows process-tree containment claim is made. Linux zombie states count as stopped (unable to execute); the sidecar reaps its direct child, while orphaned descendants are ultimately reaped by the system.
