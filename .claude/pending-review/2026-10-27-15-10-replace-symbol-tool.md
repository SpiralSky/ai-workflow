# tools: replaceSymbol — spec addition

**Date:** 2026-10-27  
**Step:** 7a-4 (symbol-level write tool; tools.md edit requires user approval)  
**Status:** pending approval

---

## Why

Orchestrate write `do` calls currently cost extra recovery turns because:

1. The executor starts cold and must re-read the file to get the exact current content needed for `edit`'s exact-match diff.
2. Even with reference passing (`@path#Symbol` in the planner instruction), the executor must dereference the reference to get the exact text before forming an `edit` call — one more turn.
3. When the symbol was already identified by name (e.g. "fix the `update` method in `service.py`"), `edit` is the wrong level: the executor knows *what* to change, not *what the old text is*.

`replaceSymbol` accepts the symbol address and the new body. It locates the symbol in the file and replaces it — no exact-match string required — so an executor that was told "rewrite `@src/service.py#update` to …" can do it in one branch call without a prior read.

---

## Proposed spec change to `docs/specifications/features/tools.md`

### §6.4 `refactor` — semantic edits

Add after the existing §6.4 table a new row — insert between `extractFunction` and `inlineSymbol` in the table:

| Tool | Effect | Purpose |
|------|--------|---------|
| `replaceSymbol` | write | Replace the entire body of a named symbol (`path#Name` or `path#Class.method`) with new source text. Takes `dryRun`. Fails if the symbol is not found or is ambiguous. Use instead of `edit` when the planner dispatches a write by symbol name and the executor should not need to read the current content first. |

No other prose changes to §6.4 needed — the existing paragraph covers `dryRun` and change-summary return for all refactor tools.

### `whenNotToUse`
(for orchestrate tool description, not in tools.md prose):  
> Use `edit` instead when only a part of the symbol changes and the unchanged lines must be preserved exactly. Use `replaceSymbol` when rewriting the whole function/method body.

---

## Parameters

```
replaceSymbol({
  symbol: string,     // "path#Name" or "path#Class.method"
  content: string,    // the new complete body (signature + body, or class body)
  dryRun?: boolean    // default false
})
```

Returns a change summary `{ files: [{ path, added, removed }], diff? }` (§4).

Throws:
- `symbol not found: <symbol>` — if the address resolves to nothing.
- `ambiguous symbol: <symbol>` — if multiple definitions match.
- `unsupported language: <lang>` — if the file's language is not supported.

---

## Implementation notes (for implementer after approval)

- Target: Python only (same as all current tools).
- Use `ast` to locate the node, preserve leading indentation and blank lines before/after.
- Replace from the `def`/`class` line through the end of the node's body (including decorators).
- `content` is the full replacement text; the tool indents it to match the enclosing scope.
- Location in `packages/tools/src/l/refactor.ts` beside `renameSymbol`, `moveSymbol`, etc.

---

## Files affected

- `docs/specifications/features/tools.md` — §6.4 table (one new row)
- `packages/tools/src/l/refactor.ts` — implementation
- `packages/tools/test/refactor.test.ts` — tests (line-only coverage, per A-35)

---

## To unblock

Approve (or revise) this spec addition. After approval, I'll add the row to tools.md and spawn
an implementer for the tool.
