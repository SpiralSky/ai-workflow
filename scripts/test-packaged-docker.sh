#!/usr/bin/env bash
# Fail-fast, no-model target-runtime preflight. Requires an authorized Docker environment.
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# Build from exact source and installed lockfile dependencies; never consume a stale dist.
node "$root/packages/server/build.mjs"
node "$root/packages/server/build.mjs" --check
# Repository-root build context consumes the single canonical Python requirements file.
docker build -f "$root/experiments/docker/aiw-base/Dockerfile" -t aiw-base:latest "$root"
# Build-time package downloads are separate from this strictly network-disabled tool probe.
# Mount only test/runtime artifacts and Node dependencies, not user credentials or the task workspace.
docker run --rm --network none \
  --mount "type=bind,src=$root/packages/server,dst=/src/packages/server,readonly" \
  --mount "type=bind,src=$root/node_modules,dst=/src/node_modules,readonly" \
  --workdir /src/packages/server \
  -e AIW_VENV=/opt/aiw/venv \
  aiw-base:latest /opt/aiw-node/bin/node \
  --import /src/node_modules/tsx/dist/loader.mjs \
  --test --test-reporter=tap test/packaged-readiness.test.ts
