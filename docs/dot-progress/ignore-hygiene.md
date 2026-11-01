# Pre-publication ignore hygiene — 2026-11-01

## Scope and decision

Branch `dot/ignore-hygiene-20261101`, based on `e390676afddf74fb7ef7ca39f4be9c9f7fe1aefd`.
User requested a pre-push audit. These are autonomous, reversible hygiene decisions,
not plan/spec approval or permission to merge. No files were removed or untracked;
no history was rewritten and no credentials were accessed or generated.

Prevent accidentally adding local `.env` variants, caches and coverage. Keep explicitly
named `.env.example`, `.env.sample`, `.env.template` trackable for sanitized examples;
these exceptions still require secret review. Do not blanket-ignore JSON, databases,
key extensions, build output, fixtures, or framework metadata: legitimate sources and
intentional distribution assets must remain reviewable.

## Evidence

- Examined tracked/untracked/ignored status across all existing worktrees. Only the
  independently active provenance worktree had source modifications/untracked sources.
- No tracked credential-named files, `.env` files, private key files, SQLite/database
  files, logs, bytecode, or local virtual environments were found by filename screening.
- Local reachable Git history scan (`git rev-list --objects --all`, read each blob)
  examined 1,240 unique blobs in this repository before this commit. Recognizers
  covered PEM/OpenSSH private-key headers, GitHub/OpenAI/AWS key formats, JWT-shaped
  strings, and quoted literal credential assignments; output included paths/types only.
- Three literal-assignment hits were deliberate anti-leak/mock values in
  `packages/runner/test/framework-launch.test.ts`, `llm-broker.test.ts`, and
  `subscription.test.ts`. No suspected genuine credentials or other recognizer hits.
- Also scanned 457 current nonignored provenance working files with the same result.
- Published PR #1 source tree `34e32bad4489ae87c26192dcc097170e1e6050b8` and
  PR #2 source tree `4dfdfc6e2a361d11384277eab7439e97a044b7f6` are included in
  the local history scan. This checks their contents, not unobserved future remote changes.
- Existing `experiments/runs/`, Python bytecode, dependencies, generated configs,
  Claude local settings, and viewer build outputs are already ignored.
- Added general `.venv/`, pytest/mypy/ruff caches, `.coverage` files, and OS metadata.
  A root-local `.config/ai-workflow/chatgpt/` is also ignored defensively if HOME is
  deliberately pointed at the checkout. Actual auth defaults to HOME outside the repo;
  arbitrary overridden credential locations still need separate safety review.
- `packages/server/dist/aiw-server.mjs`, prompts, Python sidecar and external fixtures
  are intentional portable distribution assets; all remain tracked and trackable.
  Machine-specific `dist/node_modules/` stays ignored. Synthetic benchmark workspaces,
  patches and checks remain tracked; they are not experiment output.
- Intentional `.ci` transfer/reconstruction branches are separate from feature PRs.
  The partial base64 bundle is transport, not credential material by itself. Local
  bundle head `fe2634ba2ca0d7420472727ac608a99d024f6a58` is covered by the history
  scan; SHA-256 `187928b977afe7a260a177e15da2e53b0e8fd0143ce8bdcc6655c8f059e82f30`.
  Local transport source files had no recognizer matches. No transport branch removed.

## Regression and limitations

Run `sh scripts/check-gitignore.sh`. It uses `git check-ignore --no-index` on
representative sensitive/cache paths and reviewable templates/assets, `git ls-files`
to assert required assets remain tracked, and rejects any tracked/ignored overlap.
It creates no sample secrets or artifacts. Result: PASS; `git diff --check`: PASS.
No package code changed, so package suites were not rerun for this ignore-only patch.

A pattern scan is not proof that all secrets are absent: unrecognized formats,
encoded/encrypted data, external objects, private auth stores and unobserved remote
changes are outside coverage. Existing tracked secrets cannot be fixed with ignore
rules; a genuine finding would require publication pause and credential remediation,
not automatic deletion/history rewriting. Recheck the final composed branch before push.
