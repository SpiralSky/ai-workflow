#!/bin/sh
# Filename-only regression: creates no credentials, cache, or build artifacts.
set -eu
cd "$(dirname "$0")/.."
assert_ignored() {
  git check-ignore --no-index -q -- "$1" || { echo "Expected ignored: $1" >&2; exit 1; }
}
assert_trackable() {
  if git check-ignore --no-index -q -- "$1"; then
    echo "Required reviewable path is ignored: $1" >&2; exit 1
  fi
}
assert_ignored '.env'
assert_ignored '.env.local'
assert_ignored 'packages/example/.env.production'
assert_ignored 'node_modules/example/index.js'
assert_ignored '.cache/example'
assert_ignored 'coverage/index.html'
assert_ignored '.nyc_output/example.json'
assert_ignored '.venv/bin/python'
assert_ignored 'packages/tools/.venv/bin/python'
assert_ignored '.pytest_cache/example'
assert_ignored '.mypy_cache/example'
assert_ignored '.ruff_cache/example'
assert_ignored '.coverage'
assert_ignored '.coverage.local'
assert_ignored '.config/ai-workflow/chatgpt/host.json'
assert_ignored 'experiments/runs/example/result.json'
assert_ignored 'packages/server/dist/node_modules/example/index.js'
assert_trackable '.env.example'
assert_trackable '.env.sample'
assert_trackable '.env.template'
assert_trackable 'packages/example/.env.example'
assert_trackable '.specplane/config.yaml'
assert_trackable 'AGENTS.md'
assert_trackable 'packages/server/dist/aiw-server.mjs'
assert_trackable 'packages/server/dist/python/aiw_sidecar/__init__.py'
assert_trackable 'packages/server/dist/fixtures/external/ciStatus.json'
assert_trackable 'packages/server/dist/prompts/base.md'
git ls-files --error-unmatch -- '.specplane/config.yaml' >/dev/null
git ls-files --error-unmatch -- 'AGENTS.md' >/dev/null
git ls-files --error-unmatch -- 'packages/server/dist/aiw-server.mjs' >/dev/null
git ls-files --error-unmatch -- 'packages/server/dist/python/aiw_sidecar/__init__.py' >/dev/null
git ls-files --error-unmatch -- 'packages/server/dist/fixtures/external/ciStatus.json' >/dev/null
git ls-files --error-unmatch -- 'packages/server/dist/prompts/base.md' >/dev/null
# Ignoring a file does not untrack it; flag any existing tracked/ignored overlap.
overlap=$(git ls-files -ci --exclude-standard)
if [ -n "$overlap" ]; then
  printf 'Tracked paths now ignored (inspect; do not auto-delete):\n%s\n' "$overlap" >&2
  exit 1
fi
echo 'Ignore hygiene checks passed; required versioned assets remain trackable.'
