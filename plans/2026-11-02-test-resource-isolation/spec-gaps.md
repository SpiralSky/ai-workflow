# Experimental assumptions — no approval

- **TRI-1:** Local preflight test-file scheduling is an infrastructure control, not a product behavior change. No specification body or product timeout is changed.
- **TRI-2:** The prior parallel-file failure is consistent with host contention but is not sufficient to prove its cause. Record both the original failure and serial rerun outcome; never count an unrun suite or fake child as passed.
- **TRI-3:** Baseline and candidates must use the same explicit scheduling and unchanged target matrix. A serial pass alone does not establish parallel robustness or product improvement.
