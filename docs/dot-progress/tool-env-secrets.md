# Local tool environment safety

Branch `dot/tool-env-secrets-20261101`, isolated worktree `ai-workflow-tool-env`, based on
classifier repair `3b664eed`. No other branch/protected branch edited.

Finding: local Sidecar/bash/git/tar children inherited direct DeepSeek/TypeSafe environment keys,
and ripgrep probe/search bypassed the existing filter entirely. Python execution/check children
inherit the sidecar environment. Runner container allowlisting remains distinct and protected.

Fix: filter DEEPSEEK_, TYPESAFE_, defensive CHATGPT_ alongside existing families/custom names;
use that shared filter for both ripgrep paths. No credentials were read or used. Tests construct
synthetic environments; subprocess interception verifies all seven Node launch boundaries,
and a real Sidecar/runSnippet descendant verifies inherited synthetic keys are absent.

Initial verification: three focused regressions passed, no skips; TypeScript check passed.
Plan stays draft. Final bundle and exact runtime allowance reconciliation belong to composition;
no merge, approval, remote publication, live authorization or model calls performed.

Broad package sequence stopped on first failure: core181, LLM70, runner203, server22,
telemetry17 passed; tools103/104 passed (zero skips), with the already-investigated Jedi
`renameSymbol` ambiguity regression (expected unsure line14, observed5/8/14). No retry or
assertion weakening. Jedi diagnosis is independent; full-suite success is not claimed.
Focused environment/shell/search/Git/Sidecar tests:27/27; relocated bundle plus new security
checks:4/4; typecheck and bundle freshness pass. No graph/refactor source was changed.

Authorized serial full-inventory validation (no assertion or repository test configuration changes)
passed:598 package tests +24 script tests, zero failures/skips; typecheck passed. Default-parallel
failure remains unresolved and is not recast as green. Failed log retained at
`/tmp/aiw-tool-env-tools.log`, SHA256
`10ae7d7b9e07adf7eb989e2501a7e9c68f2661d8a3aef446b5b7fb1d3700e8fc`;
fresh cache `/tmp/aiw-tool-env-cache-Vu3a` retained for independent diagnosis.

Independent artifact review caught sibling dependency labels in the first rebuilt bundle.
Replaced local dependency links with copies of existing locked packages (own-worktree @aiw links),
without installing anything or altering the lockfile. Canonical rebuild changes only three runtime
lines against3b664eed; sibling/workspace labels absent and canonical freshness passes.

Final canonical artifact validation: all22 server tests passed serially, zero skips; relocated
packaged native/tierL preflight and all3 environment regressions passed; TypeScript check passed.
Final24 script tests (including snapshot-only preservation and negative unrelated-tool allowance)
passed. Full preservation reports115 explicit runtime deltas; immutable original inventories and
all specification bodies are unchanged. Hygiene and bundle freshness pass; Specplane valid with
zero errors and existing draft/pin warnings, not approvals.

Source commit `56536b7`; canonical artifact correction `0977349`. Exact environment scope is
`packages/tools/src/env.ts`, `packages/tools/src/search.ts`,
`packages/tools/test/env-security.test.ts`; generated server bundle hash updated accordingly.
No broad tools allowance, test weakening, dependency/lockfile edit or Jedi behavior change.
Default-parallel nondeterminism remains an open issue for independent investigation; this patch
must not be described as fixing it. No live benchmark or monetary/quality improvement claimed.

## Stacked regression boundary repair

The shared migration regression file is restored byte-for-byte to the current
DeepSeek parent snapshot. The additional tool-environment scope regression now
lives in `scripts/check-tool-env-preservation.test.mjs`, automatically discovered
by the existing cloud test entry. It uses the same snapshot-only fixture approach
and unchanged assertion. This avoids adjacent end-of-file additions conflicting
across independently published stacked branches; no regression is removed.

Only test organization and this record change. Runtime source, generated bundle,
original inventories, strict preservation rules and approved-state history remain
unchanged. This is an autonomous development repair, not approval or a merge.

Validation: all 24 script tests pass with zero skips/failures, including the moved
regression and snapshot-only preservation. Full Specplane preservation confirms
115 explicit runtime deltas and original spec/history records; runtime hygiene
passes. Read-only three-tree analysis against current DeepSeek parent reports no
conflicts. Package/runtime/bundle bytes are unchanged, so no package, Docker or
live-model rerun is claimed for this test-only reorganization.
