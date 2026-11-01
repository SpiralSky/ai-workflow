# Bounded OpenAI sign-in review integration

## Development authority and review boundary

The user requested: “Add sign in to open ai support for ai-workflow workflow runs” and
“Additionally, try to approach testing in the future with saving money in mind, for example once
hitting an error, stop all other runs and try to fix the error first.” These authorize experimental
implementation, not live authentication, a paid/model run, approval, finalization or merge.

This branch is `dot/openai-signin-review-20261101`, based on migration commit
`75ab542c626bc7276d2ee9575956899c79b6d75d`. The original migration branch and PR remain unchanged.
The intended publication is a separate draft review, never a default-branch merge by the agent.
The expanded benchmark-fixture branch is deliberately excluded: experiments, imported requirement
bodies, historical HANDOFF/pending records and original immutable inventories are unchanged.

## Replayed bounded changes

| Source | Local replay | Purpose |
| --- | --- | --- |
| `1e133031b939d91d50b4502f8f624f506a15ef21` | `169dbe5` | First-terminal-failure cancellation, no automatic retry spending |
| `1540999c8d47de8184c68267e415f9a9c69d8189` | `64c2a83` | Explicit OpenAI sign-in and Responses client |
| `c60442c4dc459a830c84833ed7e17cfa3626b3ac` | `ec9302c` | Bounded host-brokered subscription workflow calls |
| `8c07295284bbd66196630ab93dce40625003b697` | `b1fe656` | Document runtime coherence dependency |
| `cb39285c3974f85794bb96fe08883c5c2df13f3b` | `0624f39` | Reproducible server artifact freshness |
| `036443f193aa9fa9a9deccf568746d4cc5ee0670` | `c4a70d0` | Honor explicit engine selection or fail before startup |

The generated bundle conflicted during the first runtime replay. It was regenerated from the
integrated source rather than choosing a stale side. After the second replay it was rebuilt again;
`node packages/server/build.mjs --check` confirms exact source/prompt coherence. Shared CLI/server
code retains the host LLM broker and selected runtime. Explicit isolated-vm requests do not silently
start QuickJS. Live native-engine/Docker execution is not established by mocked/negative tests.

## Explicit preservation allowances

`.specplane/development-allowances.json` enumerates **44** changed runtime paths, including **15**
new files, with exact before/after SHA256 and Git modes plus per-path rationale. Its base is the
verified migration snapshot. Source commit references remain informational provenance for fresh
clones. The two original migration inventories are byte-anchored and were not regenerated.

The preservation checker first validates imported requirement bodies and historical records, then
applies only the enumerated development deltas to the unchanged inventory. Before-state mismatches,
extra/missing tracked paths, changed content/modes, unrelated viewer metadata and attempts to expand
this allowance into experiments or permission/plugin paths fail. No baseline is silently replaced.
The fail-fast and sign-in plans remain draft, imported specs remain review, and those states are
explicitly checked. No approval/finish/merge command was run.

Dependency declarations now explicitly list jose/zod and the host LLM workspace dependency. Existing
verified installed dependency bytes were reused locally; workspace links resolve into this branch.
No user credential or persistent system configuration was read, copied or installed for testing.

## Integrated validation

- Configured `node scripts/test-cloud.mjs`: **466 package tests + 19 script tests passed**, zero
  failures/skips, followed by passing root typecheck. This branch excludes expanded Python benchmark
  fixtures; their separate source-branch test counts are not claimed here.
- Focused auth/provider/broker/subscription plus packaged-runtime regressions: **68 passed**.
- Preservation regression suite: **15 passed**, including snapshot-only Git, runtime/spec tampering,
  tracked additions/removals/modes, explicit new-auth-file tampering, immutable inventory changes,
  before-state mismatch, prohibited benchmark expansion and draft-plan protection.
- The actual enhanced Specplane CLI at `6ae4e304faa75b7bd5ae1240da7f4693f48d0a4e` passes validation,
  spec/context resolution and preservation in a fresh snapshot-only repository with no hidden
  local source objects. Remaining warnings are the previously documented 255 feature-body leak
  warnings and one unrelated absent-Claude-rules warning; no diagnostic was suppressed.
- Final tracked server bundle/prompt freshness check passed after rebuilding from the composed source.

These results establish offline integration and review readiness, not live sign-in success,
subscription availability, full benchmark task success, monetary savings or Docker grading.
No actual auth/model/Docker call or publication was performed by this integration task. Final user
approval and merge remain separate. For deliberate user-operated sign-in and its limits, see
`docs/openai-signin.md`.
