# orchestrate: proposed prompt wording — dispatch rules

**Date:** 2026-10-27  
**Step:** 7a-2 (fix planner prompt contradiction, option 3 approved)  
**Status:** pending approval

---

## What needs to change

Current `packages/core/prompts/orchestrate.md` lines 4–5 (the `do` section):

```
- Break the task into steps that each have a clear outcome: find the cause, apply the fix,
  run the tests. Do not hand over the whole task in one `do`.
```

This contradicts spec §3.1: when there is a specific, checkable hypothesis, the read and edit
belong in one `do` call — splitting them forces the second executor to re-read the same file
(§11.3). The "find the cause, apply the fix, run the tests" phrasing implies three separate
dispatches where one is often correct.

Also missing: a reference-passing rule for the planner when dispatching a write that follows a
read of the same file.

---

## Proposed replacement

Replace those two lines with:

```
- Break the task into steps: stop where you need to make a judgment on the result. When you
  have a specific, checkable hypothesis — "if X is the case, apply fix Y and rerun the tests;
  otherwise report what you found" — that is one step. Do not hand over the whole task in one `do`.
- When a step reads a file, include the path in the next step's instruction if an edit follows
  (e.g. `"edit @src/service.py#update to …"`). The executor will dereference it without re-reading.
```

---

## What this changes

1. **Removes the enumerated "find / apply / test" split.** Replaces with the §3.1 boundary rule
   (stop where judgment is needed). The test step still exists in the example and is implied, but
   it is no longer listed as a mandatory separate dispatch.
2. **Adds a reference-passing sentence** for write dispatches: when the planner knows which file
   to edit (from a prior read), it should name it by reference, not just by description.

---

## Files affected

- `packages/core/prompts/orchestrate.md` — the two lines above (lines 4–5 of the `do` section)

No feature spec changes (§3.1 already says this; the prompt was out of sync).

---

## To unblock

Approve this wording (or suggest revisions), then I will apply it and rebuild the server bundle.
