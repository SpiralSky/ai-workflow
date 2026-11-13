#!/bin/sh
# Extend the unchanged migration hygiene contract with required packaged assets.
set -eu
cd "$(dirname "$0")/.."
sh scripts/check-gitignore.sh
for asset in packages/server/dist/python/aiw_sidecar/__init__.py packages/server/dist/fixtures/external/ciStatus.json; do
  git ls-files --error-unmatch -- "$asset" >/dev/null
done
printf '%s\n' 'Runtime packaged assets remain tracked.'
