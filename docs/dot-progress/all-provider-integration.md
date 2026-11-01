# All-provider host broker: composed evidence

Development evidence, not plan/PR approval or live-spending authorization.
Base `179ac10803e579dd7e696b7699ed57d3199331b1`; source
`12cbb388a9b51e41457210a755f1510a53130d7c` cleanly replayed as
`b7f801e247f1735c8dd396f4b068550b39714ac0`. Direct DeepSeek candidate is not included.

Runner orchestration for all current providers uses the closed-until-attested host broker with
network-none task containers. Provider keys no longer enter runner-generated server flags or
Docker MCP environment. Sanitized typed provider errors retain classification/status without
raw diagnostics. Standalone legacy server credential flags remain outside this safe runner route;
this patch does not claim those independently invoked flags are removed or safe for secrets.

Regenerated intentional server artifact from the composed source. Original portable resource
inventory is preserved. `.specplane/development-allowances.json` now records91 exact runtime
deltas and a separate before/after stage for this patch; original immutable migration inventories,
imported requirement bodies/history and existing approval states are unchanged. New plan remains
draft and the plan index was regenerated through the pinned framework CLI.

Independent security review verified six affected runtime source files byte-identical to the
reviewed source commit, checked final bundle freshness and reran24 broker/OpenRouter tests:
24 passed, no remaining blocker for the identified runner credential-exposure issue.
Integration-focused broker/OpenRouter/ChatGPT orchestration suite:25 passed.

Ignore hygiene/required asset trackability, source/bundle freshness and actual enhanced Specplane
preservation checker passed91 runtime deltas (plus the three exact hygiene metadata hashes).
Logs: `/tmp/signin-all-provider-focused.log`, `/tmp/signin-all-provider-framework.json`.
No live auth, provider/model calls, Docker calls, secret setup, publication, approval or merge.

Final configured `node scripts/test-cloud.mjs` with verified AIW_VENV: **533 package +22 script tests**, zero failures/skips, root typecheck passed.
Log: `/tmp/signin-all-provider-full.log`.
