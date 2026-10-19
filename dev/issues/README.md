# Orchestrate Mode — Issues & Plans

Plans for resolving known issues with the orchestrate mode architecture.
Each file is self-contained: problem, root cause, and either a fix plan or
discussion questions (for issues where the design isn't settled yet).

| File | Issue | Status |
|---|---|---|
| ~~01-secondary-token-tracking.md~~ | ~~Secondary LLM token/turn counts not captured in meta.json~~ | **DONE** — subCost, orchestrateTurns, secondaryInputTok/OutputTok all tracked |
| [02-secondary-interface-language.md](02-secondary-interface-language.md) | TS vs Python for branch programs | Design decision made; monitor |
| ~~03-tool-selection-bm25.md~~ | ~~BM25 shortlist vocabulary mismatch, hard cap~~ | **DONE (2026-10-19)** — TOP_K→12, tools override added |
| [04-framing-mechanism.md](04-framing-mechanism.md) | Dynamic frameReport LLM call vs. static prompt injection | **Needs discussion first** |
| [05-codebase-tools.md](05-codebase-tools.md) | No structural codebase tools (find symbol, rename, etc.) | **Needs discussion first** |
| ~~06-cross-call-state.md~~ | ~~No persistent state across delegate calls~~ | **DONE (2026-10-19)** |
| [07-pass-rate-gap.md](07-pass-rate-gap.md) | Orchestrate 63% vs baseline 74% pass rate | **Needs discussion first** |
| ~~08-stale-docs.md~~ | ~~README/issues README have dead links and stale status for issues 01 and 06~~ | **DONE (2026-10-19)** |
| ~~09-orchestrate-prompt-contamination.md~~ | ~~Residual problem-specific hints in orchestrate-system.md (p01/p03/p04/p05)~~ | **DONE (2026-10-19)** — neutral examples in both prompt files |
| ~~10-orchestrate-dangling-reference.md~~ | ~~"(see circular import fix below)" references a removed section~~ | **DONE (2026-10-19)** |
| ~~[11-minor-design-drift.md](11-minor-design-drift.md)~~ | ~~compare/all mode aliases; attach concept in README but not HANDOFF~~ | **DONE (2026-10-19)** — ALL_MODES constant; attach removed from README |

## Working order

Discuss **04**, **05** before touching them. **07** is a symptom — it resolves as the others close.
