# HANDOFF — explicit test-file resource isolation

Plan stays draft. Authorized experimental branch: `dot/test-resource-isolation-20261102`, exact base `67b42ae04153079e84b1fdacdd0082a2e623ffc8`. No approved plan execution or finalization is claimed.

Implemented `AIW_TEST_CONCURRENCY` in `scripts/test-cloud.mjs`; use `1` for serial local acceptance, unset for prior Node default. Only test scheduling changes. All existing file discovery, assertions, native/relocated test probes, zero-skip enforcement, fail-fast behavior and final typecheck remain intact.

Focused check: `node --test --test-reporter=tap scripts/test-cloud.test.mjs` — 16 passed, zero failures/skips. Fake children verify exact process/arguments, complete fixture discovery, typecheck sequencing, validation and failure enforcement. These are not package or native-runtime passes. Full prepared-worktree acceptance is assigned to the parent; no package suite was run here and no commit was created before review.

See `docs/dot-progress/test-resource-isolation.md` for usage, original failure and evidence limits. No live models/providers/auth, Docker/VM operations, external writes, approval, merge or deletion was performed.
