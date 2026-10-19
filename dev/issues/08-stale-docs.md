# Issue 08 — Stale Documentation and Broken Issue Links

**Status:** DONE (2026-10-19)

## Problem

Two related doc staleness problems:

1. **Issue 01 marked open everywhere; code fully implements it.**
   `README.md:55,73` and `dev/issues/README.md` describe secondary token/cost
   tracking (`subCost`, `orchestrateTurns`) as unimplemented and list it as
   roadmap item #1. `experiments/run.ts:407-411` computes all three metrics from
   trace files, stores them in `meta.json`, and the viewer reads and displays them.
   The fix from issue 01 landed; the docs never caught up.

2. **Dead links to deleted issue files.**
   `dev/issues/01-secondary-token-tracking.md` and `dev/issues/06-cross-call-state.md`
   were deleted after being closed, but they are still linked from:
   - `README.md:32` → `dev/issues/06-cross-call-state.md`
   - `README.md:55,73` → `dev/issues/01-secondary-token-tracking.md`
   - `dev/issues/README.md` → rows for issues 01 and 06

## Fix Plan

1. In `README.md`, update the issue 01 reference to say "resolved" and remove
   the claim that subCost/orchestrateTurns are always 0.
2. In `README.md`, remove or fix the dead links to issues 01 and 06.
3. In `dev/issues/README.md`, mark issues 01 and 06 as DONE (matching the
   strikethrough style used for issue 03).

The deleted issue files don't need to be restored — just fix the links and
update the status text.
