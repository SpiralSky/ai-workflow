# Issue 05 — Missing Structural Codebase Tools

**Status:** NEEDS DISCUSSION — tool list and priority need to be defined with user

## Problem

The secondary LLM's entire tool surface is text-file operations: `readFile`, `edit`,
`bash`, `runTests`. There are no semantic codebase tools. As a result:

- The secondary rediscovers the codebase from scratch on every delegate call
- 1–2 turns are often wasted just grepping to find where a symbol is defined
- Refactoring tasks (rename, move) require: grep to find all occurrences, construct
  a complex multi-edit, verify — instead of one atomic operation
- No call-graph or dependency awareness

## Opportunity

The user noted: *"tools designed to be the most efficient for most jobs discretely
to reduce effort on LLM significantly"* — e.g., a JetBrains rename tool doing a
structural rename in one call vs. grep-edit-verify in 3–5k tokens.

## Open Questions for Discussion

> **AI: discuss this with the user before building any tools.**
> Ask:
>
> 1. Which tool categories should be prioritized first?
>    - **Symbol search**: find where a function/class is defined, find all callers
>    - **Structural refactor**: rename symbol, move file, extract method
>    - **Dependency/import analysis**: what imports what, detect circular imports
>    - **Test-aware tools**: run only tests touching a changed file
>    - **IDE integration**: JetBrains/LSP-backed tools (rename, go-to-definition)
>
> 2. For IDE integration (JetBrains rename etc.): is there an existing MCP or API
>    we can call, or would this require building a plugin/bridge?
>
> 3. Should these tools live in the catalog as catalog entries (so BM25 can select
>    them), or as a fixed floor set always injected into every orchestrate call?
>
> 4. What is the target language scope? Python only (current eval), or
>    language-agnostic (via LSP)?
>
> 5. Should codebase tools be able to write into the main session's context
>    (e.g., "symbol X is in file Y at line Z"), so the main LLM accumulates
>    structural knowledge across delegate calls?

## Starter Tool List (tentative, pending discussion)

| Tool | What it does | Replaces |
|---|---|---|
| `findSymbol(name)` | Returns file + line where symbol is defined | 2–3 grep turns |
| `findCallers(name)` | Returns all call sites | grep + parse turns |
| `renameSymbol(old, new)` | Atomic rename across all files | grep + multi-edit |
| `listImports(file)` | Shows what a file imports and what imports it | readFile + parse |
| `runTestsForFile(file)` | Runs only tests that cover a changed file | generic runTests |
