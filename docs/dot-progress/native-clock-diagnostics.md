# Native clock diagnostics: experimental draft

Historical record of the diagnostics-only work on 2026-11-04. The statements below about unchanged acceptance and no real-clock observations apply to that phase. See [clock validation hardening](native-clock-validation.md) for the separately authorized 2026-11-05 changes and measurement limits.

Base: 28a92f3ece3e5f502a5447281070100908a2caed. This isolated local draft adds diagnostics, not a clock correction or permission to retry.

The existing sampling predicate, 20 ms limit, clock reads and successful return fields remain unchanged. A rejected sample reports bounded numeric uptime and bracket values. Transport sampling failures add an enumerated stage and a source-owned location: initial-active, before-attempt, after-attempt or active-check. They contain no raw clock source text, boot identity, paths, environment, prompts or responses. Existing immutable failure persistence and its 1,024-character reason limit are unchanged.

Independent static review found no blocking diagnostic defect and permitted only three exact syntax checks and one synthetic test-file execution against the reviewed hashes. All three syntax checks passed. The single synthetic run passed 9/9 tests, with zero failures, skips, cancellations or stderr. Production and test hashes remained unchanged. Commands used the existing installed Node binary with an empty inherited environment; exact native-call results and separate stdout/stderr are retained outside the checkout, alongside the original unrun draft patch.

These tests cover pure formatting and fully mocked clock reads only. Transport label placement and unchanged successful read ordering were reviewed statically; no real transport or clock observation ran. This is not the unavailable aggregate check, an environment correction, a reconstruction of the prior rejected sample, or permission to retry. No helper, engine, campaign, model, provider, commit, publication or spec approval is part of this draft. Earlier failed attempts and the active source remain untouched.
