# Public native development fixture export

This branch contains task contracts, starting workspaces and public tests only.
Private grading code, held-out cases, reference solutions and fixture-control tests
are intentionally excluded. It is a partial backup, not a complete evaluation setup.

The native harness remains fail-closed. Full grading, screening and the shared test
gate require the separately retained private bundle to be restored locally. Do not
skip checks or interpret missing private assets as success. Restored private assets
are ignored by Git on this branch and must not be pushed.

These are development fixtures, not canonical benchmark tasks. No success-rate,
model-cost or cost-reduction result is established by this export.
