# Experimental native screening fixes

This development branch adds bounded supervisor failure termination, composite audit provenance validation, and allowlisted capture-failure diagnostics. It is not a release or actor-admission clearance.

Supervisor failure cannot become success merely because a timeout returns. Missing worker exit remains uncertain; late events cannot rewrite settled results. Failure teardown is idempotent and kill diagnostics are bounded. Queued callbacks stop after terminalization.

Composite audit validates separate historical and fresh output commitments, scans their union for contamination, and requires the current cell in the fresh output registry. This change contains schema logic and synthetic tests, not actual registries or grader material.

Capture diagnostics retain bounded stage/category/reason/error-code metadata without raw exception content, response payloads or credentials. Existing deadlines and success receipts remain unchanged.

Focused source controls cover supervisor lifecycle, composite audit and capture diagnostics. Full inherited integration tests and real actors were not run for publication. Existing source cohorts and failed attempts are not comparable task-quality results.
