#!/usr/bin/env bash
# Idempotent setup: checks prerequisites, installs deps, generates config, builds prompt, runs tests + typecheck.
# `setup.sh --gen-only` only (re)generates mcp.json / settings.json.
set -euo pipefail
D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$D"
if [ "${1:-}" = "--gen-only" ]; then "$D/bin/gen-config"; exit 0; fi

command -v node >/dev/null || { echo "node not found (need >=22)" >&2; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "node >=22 required, have $(node -v)" >&2; exit 1; }
command -v claude >/dev/null || { echo "claude CLI not on PATH" >&2; exit 1; }

if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "[setup] npm ci"; npm ci --silent
else
  echo "[setup] deps up to date"
fi
"$D/bin/gen-config" && echo "[setup] generated mcp.json settings.json for $D"
"$D/bin/build-prompt" >/dev/null && echo "[setup] built prompt/.system.${BRANCH_SYSTEM:-always}-${BRANCH_REPORT:-intent}.md (BRANCH_SYSTEM=${BRANCH_SYSTEM:-always} BRANCH_REPORT=${BRANCH_REPORT:-intent})"
echo "[setup] npm test";  npm test --silent 2>&1 | tail -n 8
echo "[setup] tsc";       npx tsc -p . 2>&1 | tail -n 20
echo "[setup] OK. Try: $D/bin/claude-branch"
