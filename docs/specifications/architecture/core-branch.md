# Architecture: Branch Runtime

**Derived from:** [branching-framework.md](../features/branching-framework.md)  
**Package:** `@aiw/core` → `src/branch/`  
**BF** = [branching-framework.md](../features/branching-framework.md); a bare `§N` is a section of this file.

---

## 1. Modules

| Module | Responsibility | Spec |
|--------|----------------|------|
| `compile.ts` | Program string → instrumented JS function + line map | BF §5.1, BF §7.2 |
| `instrument.ts` | AST transform inserting `__t.*` recorder calls | BF §7.2 |
| `recorder.ts` | Event recorder (`__t`), call-id allocation, `onEvent` fan-out | BF §5.4, BF §7.1 |
| `run.ts` | `runBranch()`: host side of the boundary — tool calls, state snapshots, event batches, abort, timeout, result | BF §5.1, BF §5.3 |
| `isolate.ts` | `IsolateRuntime`: create isolate, load program, inject bridge, limits, dispose | BF §5.2 |
| `stack.ts` | Map error stacks to original program lines | BF §7.2 |
| `render/trace.ts`, `render/annotated.ts`, `render/full.ts` | Event stream → model-facing text | BF §7.3–7.5 |
| `footer.ts` | State footer | BF §4.4, BF §7.3 |
| `limits.ts` | Truncation helpers, event budget | BF §7.4 |

Public API:

```ts
compileBranch(source: string): CompiledBranch | CompileError
runBranch(program: CompiledBranch, tools: BranchTools, state: State,
          opts?: { signal?: AbortSignal; onEvent?: (e: TraceEvent) => void;
                   timeoutMs?: number; memoryMb?: number },
          runtime?: IsolateRuntime): Promise<BranchResult>
renderTrace(result: BranchResult, opts: { mode: "trace" | "annotated" | "full"; source: string;
            limits?: TraceLimits; state?: State }): string
```

`BranchTools` is `Record<string, (args, ctx: CallCtx) => unknown>`: the host side of BF §6.1's
one-argument `Tool`, with the per-call ctx of A-23 added by the bridge. `renderTrace` appends the
state footer when `state` is given and non-empty.

`BranchResult` is exactly BF §5.1 (`ok`/`value` or `error`/`message`/`line?`/
`aborted?`/`stateReverted?`, both with `trace: TraceEvent[]`), plus `droppedKeys?` naming state keys
dropped as non-JSON (BF §4.4). `runBranch` never throws.

`TraceEvent` (all with `t`, ms since branch start; lines are original program lines):

| Event | Fields |
|-------|--------|
| `call` `start` / `end` | start: `id`, `line`, `name`, `args`; end: `id`, `ok`, `ms`, `result` or `error`, `aborted?`. One BF §7.1 `call` is the start/end pair, so concurrent and in-flight calls are representable; renderers merge the pair. |
| `cond` | `line`, `kind` (`if`/`ternary`/`switch`/`catch`), `value`, `pos`/`end` (source offsets of the condition, case clause or catch clause, so renderers can quote it) |
| `loop` `enter` / `iter` / `exit` | `line`; enter also `kind` (`for`/`for-of`/`for-in`/`while`/`do`) and `endLine` |
| `log` | `line`, `level`, `message` |
| `return` | `line`, `value` |
| `error` | `message`, `lines` (innermost first), `tool?`, `callId?` |

---

## 2. Compile pipeline

```
source ──parse (TS AST, original positions)──▶ validate ──▶ instrument ──▶ emit JS ──▶ load in isolate
```

1. **Wrap and parse.** The source is parsed as an expression statement `(<source>)`; the root must
   be an `async` arrow function (BF §4.1: no `function` keyword at the top level). Anything else is a
   `CompileError` with a line number, returned as a failed `BranchResult` without running.
2. **Validate.** Reject `import`/`require`/dynamic `import()` (BF §4.1 "may not import modules").
   This gives an early, clear error; the isolate enforces it anyway (BF §5.2).
3. **Instrument** (§3).
4. **Emit.** Strip types and print JS (loaded as `branch-code-<n>.js`). Each recorder call
   carries the original line as a literal, so the emitted layout is irrelevant to reported lines.
   Instrumentation (§3) is applied as text insertions into the original source that never add
   newlines, so the instrumented TypeScript keeps the original line layout. Types are then stripped
   with `ts.transpileModule` (source map on); the map gives the `lineMap` (emitted line → original
   line) used to map stack frames (tool-call lines, errors, `console`). A trailing `;` after the arrow is
   ignored. (Internal, 2026-10-24.)
5. **Load.** At run time (§4) the emitted JS is compiled inside a fresh isolate with filename
   `branch-code-<n>.js`, as an async function of `(__t, __tools, __state, console)` that calls the
   user function with `(__tools, __state)`. All four parameters are created inside the isolate.

> **Decided I-01 (2026-10-23):** `core` depends on `typescript@5.x` for the compiler API, under an npm
> alias (`"typescript-api": "npm:typescript@5.9"`) so it does not clash with the `typescript@7`
> dev dependency used for `tsc`; `typescript@7` ships only the native `tsc` binary, no JS API.

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

Not instrumented (BF §7.2): `&&`, `||`, `??`, `?.`.

Details (internal, 2026-10-24): `return` is instrumented only for the root function's returns, not
returns of nested functions or callbacks (control flow inside those is instrumented). A `switch`
clause records `__t.case(L, pos, end)` without re-evaluating the case expression. Loops are wrapped
as `{__t.loopEnter(L, kind, endLine); try { <loop> } finally { __t.loopExit(L) }}`; a labelled
loop is wrapped together with its label so labelled `break`/`continue` keep working.

Tool calls are **not** rewritten: `__tools` is a `Proxy` inside the isolate over the tool names
(§4), which records `call` events and forwards each call to the host. The calling line is taken from the stack at call time (first
`branch-code` frame) — the same mechanism as error mapping.

---

## 4. Execution

`runBranch` runs the program in a fresh isolate (§4.1) and acts as the host side of the boundary.
Nothing but JSON data crosses it (BF §5.2).

1. **Bridge.** Inside the isolate, `__tools` is a `Proxy`: `tools.x(args)` allocates a call id,
   records the `call` start (line, name, compact args, start time) and sends `{ id, name, args,
   state, events }` to the host through one async host reference, so `Promise.all` fan-out still
   runs tools concurrently. The host awaits the underlying tool with the signal in closure and
   returns `{ ok, value | error }`; the proxy records the outcome (ok/error, result, duration) and
   returns or throws. A missing tool throws `unknown tool: x` with the list of available names.
2. **Recorder and console** (`__t`, `console`) live inside the isolate and buffer events. Buffers
   are flushed to the host with every tool call, every 256 events (sync host reference) and at the
   end; the host forwards them to `onEvent` (BF §5.4). After a kill the trace
   therefore ends at most 256 events before the point where the program stopped.
3. **State.** `state` is copied in at start. Every tool call carries a copy of the current state;
   the host keeps it as the latest snapshot. On normal completion or a thrown error the final
   state is copied back. Write-back replaces `state` keys wholesale: keys the program deleted are
   deleted; a value that is not JSON-serialisable (function, cyclic) is dropped and named in the
   result message; on kill the last snapshot is kept and the result has
   `stateReverted: true` (BF §4.4).
4. **Abort and timeout.** On abort or timeout the host disposes the isolate. In-flight calls are
   marked `aborted` and the result is `{ ok: false, aborted: true, … }` with the trace flushed so
   far (BF §5.3). In-flight tools receive the abort through their own signal; their late results are
   recorded as a telemetry event only (not in the trace) and ignored. That event is the `tool`
   event the `reportTool` wrapper (§ wrapper stack, core-tools-and-hosts §5) writes when the call
   settles; `runBranch` itself does nothing with a late result.
5. **Unhandled throw** → `error` event with mapped stack (`stack.ts`, from the isolate's stack
   with the `branch-code-<n>.js` filename) and the throwing tool if the error came from a `call`
   (marked by the proxy). A tool error is rethrown in the isolate with the original `name` and
   `message` and the stack of the call site (the host's stack has no program frames).
6. **Memory limit** exceeded → isolate disposed, result `{ ok: false, error: "memory", stateReverted: true, … }`
   (state reverts to the last snapshot, as for any kill).

`error` codes: `compile` (CompileError), `thrown` (unhandled throw), `timeout`, `memory`, `aborted`
(abort signal; `aborted: true` is also set for timeout).

> **Decided A-23 (2026-10-23, approved):** Default branch timeout 120 s (configurable per framework, recorded in
> provenance as a "branch trace setting"). Time a host spends waiting for user approval is
> excluded (harness-integration §4.6): the host pauses the timeout clock through a
> `ctx.pauseTimeout()` handle passed with each inner call ([core-tools-and-hosts §4](core-tools-and-hosts.md#4-host-interface)).
> `runBranch` takes `timeoutMs` (default 120 s) and `memoryMb` (default 128) in `opts`. The
> model-facing tool still takes one argument (BF §6.1); for each call the bridge builds a per-call
> ctx (abort signal derived from `opts.signal` and the timeout; `pauseTimeout()` pauses the timeout
> clock and returns the resume function) and invokes `Host.call(req, ctx)` through the wrapper stack.

Synchronous infinite loops are stopped by the timeout like anything else: the isolate is
disposed and the model receives the failed result on its next turn. The job's wall-clock limit
(runner) remains only as a backstop.

### 4.1 Isolate runtime

`IsolateRuntime` hides the engine: `create({ memoryMb }) → { load(js, filename), bridge(hostFns),
run(), dispose() }`. The default implementation uses `isolated-vm`; `quickjs-emscripten`
(QuickJS-WASM: no native build, slower on heavy computation) is the fallback implementation.
Each branch call gets a new isolate (a few ms), so nothing — globals, patched prototypes — carries
over between calls.

> **Decided I-11 (2026-10-24):** `core` depends on `isolated-vm@6.2.0`, pinned (Node ≥ 22; contains
> the fix for GHSA-864f-rcv7-6rh4). 7.x needs Node ≥ 24. The project is in maintenance mode, which
> is why the engine stays behind `IsolateRuntime`.

`isolated-vm` requires Node to run with `--no-node-snapshot` (Node ≥ 20); the `@aiw/core` test
script sets it through `NODE_OPTIONS`.

---

## 5. Rendering

- `trace` (default): line-prefixed log exactly as BF §7.3; loops collapsed by `loopEnter`/`loopExit`
  pairs with per-iteration events summarised (ok/err counts, distinct errors with iteration
  numbers); concurrent calls ordered by start, completion on the same line, tagged with call id.
- `annotated`: projects events onto source lines as end-of-line comments; re-sends the program.
- `full`: as `trace` without value truncation, loop collapsing or event budget (the upper bound,
  BF §7.5).
- Format details beyond BF §7.3 (internal, 2026-10-24): a ternary renders as `?: <cond> → v`; all
  `for` variants render as `for`; an expanded loop prints no header; a return, error or in-flight
  call inside a collapsed loop is printed after the loop summary.
- Limits (`TraceLimits`): value truncation 200 chars, loop collapse threshold 3 iterations, event
  budget 60 events; the final `return`/`error` is always kept (BF §7.4). All three are provenance
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
- `branch` is never in its own `Tools` map (BF §6.3).
- Calls that share one `state` are serialized by a per-state mutex in the framework layer, so
  several `branch` calls in one turn (runner A-25, or a harness doing the same) run one after
  another and never race on `state`. Amended 2026-10-24.

> **Decided A-26 (2026-10-23, approved):** The `intent` field is an architecture addition derived from viewer
> §8.2, which assumes the branch call has an `intent` to show as the card title. When a call has no
> `intent`, the viewer uses the first comment line of the program.
