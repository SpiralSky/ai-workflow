# Issue 10 — Dangling Forward Reference in orchestrate-system.md

**Status:** DONE (2026-10-19)

## Problem

`framework/prompt/orchestrate-system.md:111` reads:

> "`ImportError: cannot import name X` means a circular dependency — trace which
> file imports what (see circular import fix below)."

The "(see circular import fix below)" reference points to a section that no
longer exists. The p06-specific deferred-import fix was removed from the file
during the 2026-10-19 session, but this forward reference was not cleaned up.

The secondary LLM is told to look for a section that isn't there, which is
confusing and potentially causes unnecessary recovery attempts.

## Fix Plan

Edit `framework/prompt/orchestrate-system.md:111`: remove the parenthetical
`(see circular import fix below)` from the sentence, or replace it with
actionable inline guidance (e.g., "use a local import inside the function
to break the cycle").
