# Explicit experimental decisions — no approvals

- **PV-1:** Runner §9 proposes a throwaway framework server preflight. This implementation observes each actual job server before its first model request instead, without throwaway model calls. Static metadata exists before run creation; runtime maps remain explicitly pending until observed. An incomplete new run cannot be finalized complete.
- **PV-2:** Existing wall-clock configuration is not actually enforced by the runner. Preserve its declared value but explicitly record `wallClockEnforced: false`; do not claim full limit fidelity. Nondefault branch timeout/trace limits that the server does not consume are rejected rather than mislabeled.
- **PV-3:** Formats gain optional `integrity` metadata and per-turn `providerModel` / `providerSystemFingerprint`. Requested `model` remains unchanged for compatibility. Provider strings are opaque observations, not proof of exact weights or snapshot immutability.
- **PV-4:** New attested runs cannot combine with legacy unattested runs. Existing legacy report behavior is retained for historical inspection only; absence of integrity is not evidence of a verified baseline.
- **PV-5:** Grade with the immutable image observed on the actual job container. Direct legacy three-argument grading callers retain their old tag fallback; the evaluation job path supplies the observed ID.

All original specification/status/provenance records remain untouched. This draft records the user's autonomous-development exception, not an approval.
