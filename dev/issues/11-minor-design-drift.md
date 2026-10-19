# Issue 11 — Minor Design Drift (compare/all aliases; attach concept)

**Status:** Low priority — two small inconsistencies, no functional impact

## Problem A — compare and all are identical

`CLAUDE.md` lists `compare` and `all` as separate modes implying distinct
semantics:

```
- compare — shorthand for baseline + branch-only + orchestrate (all three, default)
- all     — all three modes
```

`experiments/run.ts:475-477` expands both to `["baseline", "branch-only", "orchestrate"]`.
They are aliases. The documentation implies they differ; the code makes them
the same.

**Fix options:**
1. Merge them (remove `all`, keep `compare`) — simplest.
2. Give `all` distinct semantics when new modes are added (e.g., always includes
   every registered mode), documenting the intended difference now even if it's
   not observable yet.

## Problem B — attach escape hatch undocumented in HANDOFF

`README.md` (Planned: orchestrate-active section) mentions:

> "metered `attach(path, lines?)` escape hatch"

for the coordinator tool set. `HANDOFF.md`'s orchestrate redesign design notes
make no mention of `attach`. This concept exists only in README and has no
corresponding design thinking written down.

**Fix:** Either add an `attach` note to HANDOFF's redesign section, or remove
it from README if it was rejected.
