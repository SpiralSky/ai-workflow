# Orchestrate Mode — Issues & Plans

Plans for resolving known issues with the orchestrate mode architecture.
Each file is self-contained: problem, root cause, and either a fix plan or
discussion questions (for issues where the design isn't settled yet).

| File | Issue | Status |
|---|---|---|
| [01-secondary-token-tracking.md](01-secondary-token-tracking.md) | Secondary LLM token/turn counts not captured in meta.json | Clear fix — implement |
| [02-secondary-interface-language.md](02-secondary-interface-language.md) | TS vs Python for branch programs | Design decision made; monitor |
| [03-tool-selection-bm25.md](03-tool-selection-bm25.md) | BM25 shortlist vocabulary mismatch, hard cap | **Needs discussion first** |
| [04-framing-mechanism.md](04-framing-mechanism.md) | Dynamic frameReport LLM call vs. static prompt injection | **Needs discussion first** |
| [05-codebase-tools.md](05-codebase-tools.md) | No structural codebase tools (find symbol, rename, etc.) | **Needs discussion first** |
| [06-cross-call-state.md](06-cross-call-state.md) | No persistent state across delegate calls | **Needs discussion first** |
| [07-pass-rate-gap.md](07-pass-rate-gap.md) | Orchestrate 63% vs baseline 74% pass rate | **Needs discussion first** |

## Working order

Start with **01** (visibility before optimizing). Then discuss **06** (biggest
architectural gap). **03**, **04**, **05** in parallel once direction is clear.
**07** is a symptom — it resolves as the others close.
