# Architecture: Branch Runtime

**Derived from:** [branching-framework.md](../features/branching-framework.md)  
**Package:** `@aiw/core` → `src/branch/`

---

## 1. Modules

| Module | Responsibility | Spec |
|--------|----------------|------|
| `compile.ts` | Program string → instrumented JS function + line map | §5.1, §7.2 |
| `instrument.ts` | AST transform inserting `__t.*` recorder calls | §7.2 |
| `recorder.ts` | Event recorder (`__t`), call-id allocation, `onEvent` fan-out | §5.4, §7.1 |
| `run.ts` | `runBranch()`: inject tools/state/console, abort, keepalive, result | §5.1, §5.3 |
| `stack.ts` | Map error stacks to original program lines | §7.2 |
| `render/trace.ts`, `render/annotated.ts`, `render/full.ts` | Event stream → model-facing text | §7.3–7.5 |
| `footer.ts` | State footer | §4.4, §7.3 |
| `limits.ts` | Truncation helpers, event budget | §7.4 |

Public API:

```ts
compileBranch(source: string): CompiledBranch | CompileError
runBranch(program: CompiledBranch, tools: Tools, state: State,
          opts: { signal?: AbortSignal; onEvent?: (e: TraceEvent) => void }): Promise<BranchResult>
renderTrace(result: BranchResult, opts: { mode: "trace" | "annotated" | "full"; source: string;
            limits: TraceLimits }): string
```

`BranchResult` is exactly branching-framework §5.1 (`ok`/`value` or `error`/`message`/`line?`/
`aborted?`, both with `trace: TraceEvent[]`). `runBranch` never throws.

---

## 2. Compile pipeline

```
source ──parse (TS AST, original positions)──▶ validate ──▶ instrument ──▶ emit JS ──▶ new AsyncFunction
```

1. **Wrap and parse.** The source is parsed as an expression statement `(<source>)`; the root must
   be an `async` arrow function or async function expression (§4.1). Anything else is a
   `CompileError` with a line number, returned as a failed `BranchResult` without running.
2. **Validate.** Reject `import`/`require`/dynamic `import()` (§4.1 "may not import modules").
   This is a contract check, not a sandbox (§5.2).
3. **Instrument** (§3).
4. **Emit.** Strip types and print JS; append `//# sourceURL=branch-code-<n>.js`. Each recorder call
   carries the original line as a literal, so the emitted layout is irrelevant to reported lines.
5. **Construct.** `new AsyncFunction("__t", "__tools", "__state", "console", body)` where the body
   calls the user function with `(__tools, __state)`.

> **Decided I-01 (2026-10-23):** `core` depends on `typescript@5.x` for the compiler API, under an npm
> alias (`"typescript-api": "npm:typescript@5.9"`) so it does not clash with the `typescript@7`
> dev dependency used for `tsc`. Checked: the installed `typescript@7.0.2` package ships only the
> native `tsc` binary, no JS API, so (b) is unavailable; (c) deviates from the spec's mechanism.
> The current prototype `framework/core/branch/branch.ts` uses `stripTypeScriptTypes` and must
> move to this pipeline.

---

## 3. Instrumentation

Rewrites (line `L` from the original AST node start):

| Construct | Rewrite | Event |
|-----------|---------|-------|
| `if (c)` / `else` | `if (__t.cond(L, "if", c))` — `else` branch recorded via the same result | `cond` |
| `c ? a : b` | `__t.cond(L, "ternary", c) ? a : b` | `cond` |
| `switch` case taken | `case X: __t.case(L, X);` at the top of each clause | `cond` (kind `switch`) |
| `catch (e)` | first statement `__t.cond(L, "catch", true)` | `cond` |
| `for` / `for…of` / `for…in` / `while` / `do` | `__t.loopEnter(L)` before, `__t.loopIter(L)` at body start, `__t.loopExit(L)` after (incl. `break`/`return`/throw via `try/finally`) | `loop` |
| `return x` | `return __t.ret(L, x)` | `return` |
| arrow with expression body (root) | treated as `return` | `return` |

Not instrumented (§7.2): `&&`, `||`, `??`, `?.`.

Tool calls are **not** rewritten: `__tools` is a `Proxy` over the `Tools` map built by `run.ts`
(§4), which records `call` events. The calling line is taken from the stack at call time (first
`branch-code` frame) — the same mechanism as error mapping.

---

## 4. Execution

`runBranch`:

1. Build the call proxy: for each `tools.x(args)` → allocate call id, record `call` start
   (line, name, compact args, start time), await the underlying tool with the signal in closure,
   record outcome (ok/error, result, duration). A tool that is missing → throws
   `unknown tool: x` with the list of available names.
2. Inject `console` whose `log/info/warn/error` record `log` events.
3. Keepalive: a ref'd interval timer while any tool promise is pending; cleared on completion.
4. Race the program against the signal. On abort: mark in-flight calls `aborted`, return
   `{ ok: false, aborted: true, … }` with the partial trace (§5.3). In-flight tools receive the
   abort through their own signal; their late results are recorded as `late` and ignored.
5. Unhandled throw → `error` event with mapped stack (`stack.ts`) and the throwing tool if the
   error originated from a `call` (identified by an internal symbol on errors re-thrown by the
   proxy).
6. `state` is mutated in place and kept on failure (§4.4).

> **Decided A-23 (2026-10-23, approved):** Default branch timeout 120 s (configurable per framework, recorded in
> provenance as a "branch trace setting"). Time a host spends waiting for user approval is
> excluded (harness-integration §4.6): the host pauses the timeout clock through a
> `ctx.pauseTimeout()` handle passed with each inner call ([core-tools-and-hosts §4](core-tools-and-hosts.md#4-host-interface)).

Synchronous infinite loops cannot be interrupted (§5.2, accepted). In the runner, the job's wall
clock limit kills the container in that case and the job is recorded as a fail with reason
`timeout` — this is a framework outcome, not an infra error.

---

## 5. Rendering

- `trace` (default): line-prefixed log exactly as §7.3; loops collapsed by `loopEnter`/`loopExit`
  pairs with per-iteration events summarised (ok/err counts, distinct errors with iteration
  numbers); concurrent calls ordered by start, completion on the same line, tagged with call id.
- `annotated`: projects events onto source lines as end-of-line comments; re-sends the program.
- `full`: as `trace` without value truncation or loop collapsing.
- Limits (`TraceLimits`): value truncation 200 chars, loop collapse threshold 3 iterations, event
  budget 60 events; the final `return`/`error` is always kept (§7.4). All three are provenance
  fields.
- Footer: `state: key(type/size), …`; references (objects with a `ref` marker,
  [orchestrate-engine §6](orchestrate-engine.md#6-reference-store)) rendered as `ref <path#sym>`.

The full event stream is attached for the viewer through `reporter.attach("branch.events", …)`
and the rendered model-facing text through `attach("branch.trace", …)` ([telemetry §2](telemetry.md#2-reporter)).

---

## 6. The `branch` tool

The `branch` tool is assembled outside the runtime, by the framework layer
([core-tools-and-hosts §6](core-tools-and-hosts.md#6-framework-tool-assembly)):

- Input schema: `{ code: string; intent?: string }`. `intent` is a one-line label shown as the card
  title in the viewer (viewer §8.2); it is optional and not shown back to the model.
- Description: fixed prompt text + generated declarations of the tools passed in.
- Result text: `renderTrace(...)`. Failure results are MCP `isError: true` with the same text
  (harness-integration §5.2).
- `branch` is never in its own `Tools` map (§6.3).

> **Decided A-26 (2026-10-23, approved):** The `intent` field is an architecture addition derived from viewer
> §8.2, which assumes the branch call has an `intent` to show as the card title. If not approved,
> the viewer uses the first comment line of the program instead.
