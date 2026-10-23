# Idea: Known-Good Hot Paths

**Status:** Adopted 2026-10-23 — see [orchestrate §9](../specifications/features/orchestrate.md) and [orchestrate-engine §4.5](../specifications/architecture/orchestrate-engine.md#45-hot-paths)  
**Related spec:** [branching-framework.md](../specifications/features/branching-framework.md)

---

## Problem

The branching framework asks the model to write defensive code for outcomes it anticipates.
Two skills are required for this to work well:

1. **Anticipation** — knowing which outcomes can occur for a given tool call (e.g., "file not found",
   "command exits non-zero", "output is empty").
2. **Foresight planning** — knowing what to do next when an anticipated outcome occurs
   (e.g., if `grep` returns nothing, broaden the search pattern or try a different directory).

Both skills are weak in smaller models and inconsistent even in strong ones without examples.
A model that has never seen "grep returns nothing → widen search → retry" written out will
often write a branch that simply propagates the empty result upwards and returns to the caller,
losing the opportunity to recover.

---

## Idea

Maintain a catalog of **known-good hot paths**: short, reusable TypeScript snippets that encode
a complete anticipation + recovery pattern for a common tool-call outcome.

Examples:

```ts
// hot path: file search with fallback
const result = await tools.bash(`find . -name "${filename}" 2>/dev/null | head -5`);
if (!result.trim()) {
  // widen: drop directory constraint
  const fallback = await tools.bash(`find / -name "${filename}" 2>/dev/null | head -5`);
  if (!fallback.trim()) return { found: false };
  return { found: true, path: fallback.trim().split('\n')[0] };
}
return { found: true, path: result.trim().split('\n')[0] };
```

```ts
// hot path: edit with existence check
const content = await tools.readFile(path).catch(() => null);
if (content === null) return { ok: false, reason: 'file not found' };
// ... proceed with edit
```

These snippets are injected into the model's context alongside (or instead of) the raw tool
descriptions, so the model has concrete patterns to adapt rather than having to invent them.

---

## Relationship to the existing catalog / BM25 shortlist

The codebase already has a `ToolEntry` catalog used by the orchestrator to select which tool
implementations to inject into a secondary LLM's context (BM25 shortlist, `src/catalog.ts`).

Hot paths could live in the same catalog as an additional field on each entry:

```ts
interface ToolEntry {
  name: string;
  description: string;
  hotPaths?: string[];  // annotated snippets for common outcomes
  // ...existing fields
}
```

Alternatively they could be a separate catalog indexed by `(toolName, outcomeType)`.

The right home depends on whether hot paths are injected per-tool-call or per-branch-program.

---

## Open questions

- **Injection granularity:** inject all hot paths for the tools in the shortlist, or let the
  model select which patterns apply?
- **Staleness:** hot paths are hand-written and will drift from tool behaviour as tools evolve.
  Who maintains them?
- **Generative alternative:** instead of hand-written snippets, use a separate pass where a
  strong model generates hot paths from tool descriptions. Likely overkill for now.
- **Interaction with annotations layer:** if the runner already logs which branches were taken
  and key variable values (see §7 of the feature spec), the model gets feedback that may
  reduce the need for explicit hot-path patterns. These two mechanisms may partially substitute
  for each other.

---

## Next step if pursued

Prototype: add a `hotPaths` field to one tool entry (`bash` or `readFile`), inject it into
the secondary LLM system prompt, and compare branch program quality with and without it on
2–3 eval problems. Small n, qualitative assessment first.
