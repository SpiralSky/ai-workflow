# AI Workflow — Handoff

> **To resume**: read this file, then see the [Roadmap](README.md#roadmap) in the main README for pending work.

---

## Specs: Final

The Anthropic prior-art comparison is in orchestrate §2.1 and §10.2 and in the README.

**Open prior-art follow-ups:**
- Orchestrate bets that delegation cost (tokens, latency, lossy reports) is outweighed by cheaper actions. `resolve`,
  conditional intents and the re-read / planner-vs-executor token metrics (orchestrate §10.1) must show which cost
  dominates. Coding steps are interdependent (Anthropic: weaker fit for multi-agent).
- Branch's line-level trace (Anthropic PTC shows only logged/returned output) is a hypothesis to test.
- Anthropic's numbers are frontier-model results; results on deepseek-v4-flash are an open gap worth reporting.
- Consider rewriting branching-framework §1–2 to cite prior art and frame branch as the code-mode baseline/executor.

Spec review F1–F20 and the final check (2026-10-24) are complete; all feature specs are **Final**
(changes now need the user's approval). Notable final-check decisions: Claude Code plugin uses a
hooks module (prompt.compose / tool.call routing / tool.describe deferral) instead of agents +
settings.json; read-only mode denies non-read calls; task.md is the first user message; budget
per framework-runner §6.5 (CLAUDE.md updated); large dev problem deferred until `fulfil` exists.

**Next (in order):**
1. ~~Sort out the uncommitted working tree~~ — done 2026-10-24 (tree clean).
2. Rebuild the codebase to the architecture specs (README Roadmap step 2): ~~telemetry~~ (done 2026-10-24,
   `packages/telemetry`) → **LLM client (`packages/llm`, next)** → core branch per architecture/core-branch.md.
3. Test the existing modes first: clean `compare` (baseline, branch-only, orchestrate) — Roadmap step 3.
4. Only then: user's new orchestrate idea (adds one mode) — not yet presented; it goes through spec approval.

Commit spec/README changes as `docs:` commits when the user approves.

---

## Code state: `framework/core/branch/`

`branch.ts` (+ `framework/test/core-branch.test.ts`, committed 3f6aeb9) is an early in-process runner from 2026-10-21. It
predates the architecture specs and does not match them (no isolate, instrumentation, recorder, `state` or renderers).
Rebuild it per architecture/core-branch.md rather than patching it; the old `src/runner.ts` path is replaced afterwards.
npm workspaces root (A-02) exists: `npm test` / `npm run typecheck` at the repo root; `framework/` is not a workspace.
Telemetry choices not in the spec: `wrapTools` nests a tool's calls directly under its tool id (no `scope`
event); the explicit reporter wins over `currentReporter()`; `fromMeta(meta, root)` derives from the server's root
reporter so `s:n` ids stay unique; `wrapLLM` takes an `LLMClient` interface returning already-normalised usage
(telemetry can't import `@aiw/llm`), so `@aiw/llm` must implement that interface.
Workflow: the main session designs and orchestrates; subagents execute in small, self-contained steps. Use
Sonnet subagents (`model: "sonnet"`) for implementation and Haiku (`model: "haiku"`, weaker) for simple mechanical
tasks; the main agent reviews their output.
