# Nonoperational native role-budget prototype

This draft provides pure quota and settlement primitives. It is not connected to the runner, source-owned completion launch or an archival sink. It does not admit actors or establish complete tool accounting.

Sequential reservations bind source, cell, completion sequence, role and reservation identity. Accounting preserves the cumulative 256-call/2MiB limits and original 1MiB+8192 pre-call reserve. Exact argument templates, session lifecycle checks and sticky failures reject inconsistent or uncertain settlement.

The finite archival design accounts for a ledger prefix and a separate actual final archival call/result, including duplicated payload bytes. No recursive self-recording or expected-result reconstruction is permitted.

Integration remains blocked without an exact supported child-to-parent transfer of the final tool result. Model-reported text is not such a transfer. Quota failure after sink launch also does not prove process closure; cleanup must remain uncertain until closure is observed. Final coordinator persistence retains an explicit procedural evidence boundary.

39 deterministic synthetic tests cover the pure draft. No actor, model, external tool or filesystem fixture is used by these tests. The full project suite was not run for this draft. Further integration and independent review are required before operational use.
