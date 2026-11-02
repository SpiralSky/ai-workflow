# Hot-path prototype handoff

## Authorization and checkout

The user said **"Keep working on and improving it"**, scoped to ai-workflow only.
This is independently authorized experimental development, not specification approval.
Branch: `dot/hotpath-prototype-20261102`; exact starting base: `67b42ae04153079e84b1fdacdd0082a2e623ffc8`.
The draft plan is recorded in this separate development checkout under the repository's
experimental exception; no ready/done status, plan finish, merge, or approval is implied.

## Progress

- Read AGENTS.md, CLAUDE.md, resolved config paths and Specplane skill.
- Audited feature/orchestrate §9, architecture/orchestrate-engine §4.5, selection,
  executor, handoff and actual S/L tool signatures.
- Created this draft through the verified local Specplane CLI `plan new` command.
- Final combined focused tests **149/149** pass (seed, index, integration, variant and executor), and typecheck passes. These are mock-only functional checks, not an efficacy evaluation.
- Specplane validation passes (257 warnings); plan-next confirms draft/action none.
- Exact core after-state hashes and new-file `before: null` allowances refreshed; immutable inventory anchors and all historical before states checked unchanged.
- Four preservation tamper regressions added; running them awaits parent staging/new bundle hash so snapshot-only tests include the new files.

## Next

Parent reviews the candidate, stages the new files, rebuilds the server bundle and updates
its exact after hash, then coordinates composed serial checks. No commits until review.

## Boundaries

No providers, credentials, spending, deployment, guest dispatch, broad host search,
external changes or imported spec-body edits. Defaults and fixed60 remain unchanged.

## Independent review correction

Preserved upstream truncation in test/check summaries, renamed local omitted counters to
`omittedVisible*`, and distinguished no-visible-error from clean. Added three seed
regressions and two runner provenance/canonical treatment regressions. Final focused
counts: core 149/149 and runner/server 37/37. Updated both allowance after-state sets;
all before states retained. Parent rebuilds bundle and updates its own after-state entry.

## Hidden-text provenance alignment

Added explicit canonical reviewed catalog fingerprint per architecture/runner §9, in
observed server prompts and host expected prompts. Kept all markdown equality checks;
enabled hot paths reject missing/mismatched hashes, even if both maps agree on bad data.
Mutation/source-attestation checks pass 23/23 and typecheck passes. Parent rebuilds the
bundle before the new compiled-server no-model listTools test and broad rerun. Runtime
allowance after states updated in both sets; original before states retained.
