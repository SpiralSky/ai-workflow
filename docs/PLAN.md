# Branching Loop Framework — JS/TS Plan

## Goal
An agent loop where the main LLM can emit a small **TS program** (a "branch") instead of a single tool call.
The harness runs it in a sandbox; tool outputs stay out of context; cheap classifiers make mid-program
decisions; the program either returns a compact result to the LLM or ends the turn with a pre-written
user message. Target: fewer LLM turns and fewer context tokens than a plain tool loop, at equal success rate.

## Decisions so far (from design discussion)
- **Language:** TS with `async/await` + named variables (replaces the custom `do/then/capture` DSL).
  Chaining allowed for pure transforms only.
- **Branches only for common, multi-path steps.** Happy path + default fallback "return to LLM".
  Model may write more branches when history shows repeated failure.
- **Classifiers for fuzzy decisions only;** deterministic checks (exit codes, `endsWith("OK")`, try/catch) otherwise.
- **`llm()` sub-call results are consumed inside the branch** (e.g. fed into `edit`), not returned for re-emission.
- **Harness, not model, routes `llm()`** between fresh sub-call and main LLM (cost + failure risk).
- **Built-in helpers are cheap** (cached input) vs output tokens → grow a helper library, bounded by selection accuracy.
- `$$` description → leading comment; harness adds the *actual* path taken.

## Borrowed features
| Feature | Source | Where it lands |
|---|---|---|
| Tools exposed as a typed TS API (`.d.ts` as tool docs) | Cloudflare Code Mode | `prompt/helpers.d.ts` |
| Sandbox has no I/O; all effects go through host bindings | Code Mode (Workers bindings) | `sandbox/` + `bridge.ts` |
| Only final output enters context; opt-in per tool (`allowed_callers`) | Anthropic Programmatic Tool Calling | helper registry flag `callableFromBranch` |
| Tool use examples in definitions; lazy tool search when helper set grows | Anthropic advanced tool use | `prompt/`, Phase 5 |
| Large data as variables/handles, not prompt text; sub-LLM over slices | Recursive Language Models (RLM) | handle store, `llm({ctx})` |
| Persistent interpreter state across turns | RLM, smolagents | Phase 3 |
| Compact error feedback (line + message) on code failure; max-steps limit | smolagents CodeAgent | `runner.ts` |
| Code actions > JSON actions (control flow + variables) | CodeAct | justifies `branch` tool |
| Plan-then-execute without observing intermediates | ReWOO | branch semantics |
| Joiner: decide finish vs re-plan, pass attempt + failure back | LLMCompiler | fallback payload |
| Parallel independent calls | LLMCompiler | `parallel()` / `Promise.all` guidance |
| Constrained choice from fixed labels | Guidance `select`, LMQL | `classify()` |
| Pre-written user message, sent after verification (no final LLM turn) | **own** | `returnUser()` |
| Mid-program cheap classifiers in model-written code | **own** | `classify()`/`check()` |
| Runtime sub-call vs main-LLM routing | **own** | `router.ts` |

## Architecture
```
main LLM ──tool_use: branch{code}──▶ runner ──▶ sandbox (isolate, no I/O)
   ▲                                   │            │ await helper(...)
   │  compact result + path summary    │            ▼
   └───────────────────────────────────┘      bridge (host) ──▶ bash / fs / tests
                                               │  limits, permissions, trace log
                     returnUser(msg) ──────────┼──▶ user (turn ends, no LLM call)
                                               └──▶ classify / weakLLM / llm (router)
```
- **Tools offered to main LLM:** `branch({code})` plus a few direct tools (`bash`, `edit`) for trivial one-shots
  (a branch adds nothing for a single call).
- **Exit semantics:** `return x` → serialized result to main LLM (size-capped; overflow stored as a handle).
  `returnUser(msg)` throws a harness signal → ends the turn. Uncaught exception → `{error, line, attempted_code}` to LLM.
- **Path summary** (auto, appended to result): e.g. `[readSymbol → llm(sub) → edit → runTests: ok]`.
- **Limits per branch:** wall-clock timeout, max helper calls, max `llm()` calls, max returned chars.
- **Trace:** JSONL per run — every helper call, args, result size, duration, tokens/cost per LLM call, path taken.
  Full outputs kept here (retrievable via handle), never in context by default.

## Helper API sketch (`prompt/helpers.d.ts`)
```ts
// effects
declare function bash(cmd: string, opts?: { timeoutMs?: number }): Promise<{ code: number; out: string }>;
declare function readFile(path: string): Promise<string>;
declare function readSymbol(path: string, name: string): Promise<string>;   // replaces ad-hoc awk
declare function findFiles(glob: string): Promise<string[]>;
declare function edit(path: string, oldStr: string, newStr: string): Promise<void>;
declare function runTests(filter?: string): Promise<{ ok: boolean; failures: string }>;
// decisions
declare function check(text: string, question: string): Promise<boolean>;
declare function classify<L extends string>(text: string, labels: Record<L, string>): Promise<L>;
// models
declare function weakLLM(prompt: string, opts?: { ctx?: unknown[] }): Promise<string>;
declare function llm(prompt: string, opts?: { ctx?: unknown[] }): Promise<string>;   // harness routes
// control
declare function parallel<T extends readonly unknown[]>(...ps: T): Promise<{ [K in keyof T]: Awaited<T[K]> }>;
declare function returnUser(message: string): never;
declare const state: Record<string, unknown>;   // persists across turns (Phase 3)
```
Composite helpers (e.g. `editAndVerify`) are added only when trace mining shows a repeated pattern.

## Phases (each gated on testbed metrics)

**Phase 0 — Eval harness + baseline**
- `eval/run.ts`: copy problem to temp dir, run agent with PROBLEM.md prompt, run tests, record
  success, LLM turns, input/output/cached tokens, cost, wall time. N runs per problem.
- Baseline: plain tool loop (bash + edit only), same model.
- Exit: reproducible metrics table for problems 01–05.

**Phase 1 — Minimal branch runtime**
- Agent loop, `branch` tool, sandbox, bridge, `bash/readFile/readSymbol/edit/runTests`, `return`/`returnUser`,
  limits, error feedback, path summary, JSONL trace.
- System prompt: when to branch vs direct call, 2–3 worked examples (01-style fix+verify).
- Exit: 01 solved in ≤2 LLM calls; no success-rate drop vs baseline on 01–05.

**Phase 2 — Decision + model helpers**
- `check`/`classify` backed by weak model (Haiku-class) with output forced to the label set.
- `weakLLM`/`llm` with explicit `ctx`; `llm` initially always sub-call.
- Size-capped returns with overflow → handle.
- Exit: classifier accuracy logged per call (spot-check from traces); token savings visible on 03/05.

**Phase 3 — Persistent state + handles (RLM)**
- Keep isolate (or serialized `state`) alive across turns; large values referenced as `$hN (size, origin)`.
- Exit: later branches reuse earlier data without the main LLM reading it.

**Phase 4 — Routing + re-plan**
- `router.ts`: estimate cost(sub-call) vs cost(main, cached ctx, cache warm?) and failure risk
  (prior failure, user constraints, cross-file deps) → choose. Escalate to main after any failed attempt.
- Joiner-style fallback payload: `{attempted, failure, path}`.
- Exit: on 03/04, escalations happen where expected; net cost ≤ Phase 2.

**Phase 5 — Optimizations**
- Local/cheap classifier backend (embedding or zero-shot) with confidence → escalate to weak LLM when low.
- `parallel()` + prompt guidance; mine traces for composite helpers; tool search once helpers > ~20;
  optional MCP schema → TS API generation (Code Mode).

**Phase 6 — Experiments**
- `.then` chaining vs `await`/variables (same helpers, two prompts).
- Helper set size vs selection accuracy.
- Branching vs plain loop on problems where 04 (ambiguity) should trigger a question.

## Layout (actual; see README.md)
```
framework/  src/server.ts runner.ts helpers.ts llm.ts trace.ts report-core.mjs   prompt/  bin/  test/
eval/run.ts                 benchmark harness (runs → eval/runs/, gitignored)
loop-testbed/problems/      the 5 problems
dev/jobs/                   specs for delegated dev tasks (dev/run-job)
```
Not built yet from the original sketch: `bridge.ts` (helpers call host directly), `router.ts` (Phase 4), `prompt/examples/`.

## Status
See HANDOFF.md. Decided: Node 22 + node:vm (Phase 1), MCP tool inside Claude Code instead of own agent loop, sub-LLM via `claude -p` CLI.

## Open decisions
1. **Runtime:** Node 22+ (recommended; best SDK support) vs Bun vs Deno.
2. **Sandbox:** `isolated-vm` (V8 isolate in Node, recommended) vs Deno subprocess with no permissions vs
   QuickJS-wasm. Plain `node:vm` is fine for Phase 1 local experiments only — it is not a security boundary
   (acceptable early since the agent already has `bash`).
3. **Main model:** Sonnet-class (cheaper, more runs) vs Opus-class.
4. **Direct tools alongside `branch`:** keep (recommended) or branch-only.
5. **Persistence mechanism (Phase 3):** long-lived isolate vs serialize `state` between turns.
