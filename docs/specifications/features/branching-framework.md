# Feature: Branching Framework

**Status:** Final  
**Area:** Core agent interface  
**Related:** `framework/core/branch/`

---

## 1. Summary

The branching framework replaces the per-turn tool-call interface with a code-writing interface.
Instead of calling individual tools one at a time and waiting for results, the model writes a TypeScript
function — a *branch program* — that calls multiple tools in a single turn, handles their results
inline, and returns a value. This lets the model encode decision trees, retry logic, and conditional
paths that would otherwise take several round-trips.

---

## 2. Motivation

Standard tool-call interfaces are strictly sequential: one call, one result, one new turn.
This imposes a latency and token cost on any task that requires:

- Checking a condition before acting (read → decide → write)
- Retrying on failure
- Fanning out over a list of items
- Short-circuiting on early success

Each of those patterns costs at least one extra turn today. The branch tool collapses common
multi-step patterns into a single model output, at the cost of requiring the model to write
correct TypeScript.

---

## 3. User-visible behaviour

From the model's perspective, there is one tool: `branch`.
Its input is a TypeScript function body (a string).
Its output is a structured execution trace of what happened, including the return value (see §7).

The model **does not** receive raw JSON tool call results mid-branch.
It receives the execution trace only after the entire program has finished.

From the operator's perspective, the tool is registered in the normal way and the execution
environment is configured separately (see §6).

---

## 4. Branch program contract

The model writes a TypeScript function with the following signature:

```ts
async (tools: Tools, state: State): Promise<unknown>
```

`Tools` is a `Record<string, Tool>` injected by the runner (see §6).
`State` is a plain object that persists across branch calls (see §4.4).
Every tool takes a single argument object: `tools.readFile({ path: "a.ts" })`, `tools.bash({ cmd: "ls" })`.

### 4.1 Constraints

- The function must be an `async` arrow function or expression (no `function` keyword at the top level).
- It may use any standard TypeScript/JavaScript language features.
- It may not import modules — the only external interface is `tools`.
- It may call tools in sequence or in parallel (`Promise.all`).
- It should return a value meaningful to the model; it appears in the execution trace (see §7). Returning `undefined` is valid.
- **A branch never ends the turn.** Its result always goes back to the model that called it, which
  then decides what to do next (reply to the user, run another branch, …). There is no special
  "return to user" signal.

### 4.2 Defensive coding (model responsibility)

The model is expected to write defensive code for outcomes it can anticipate. Examples:

- A file search that returns empty → broaden the search pattern or try a different directory.
- A command that exits non-zero → inspect stderr, decide whether to retry or surface the error.
- A read that returns an unexpected structure → guard before accessing nested fields.

This requires two skills that vary significantly across models:

- **Anticipation** — knowing which outcomes are possible for a given tool call.
- **Foresight planning** — knowing what recovery action to take for each anticipated outcome.

Weaker models often write only the happy path. Providing concrete examples (see
[known-good hot paths idea](../../ideas/known-good-hot-paths.md)) or fine-tuning on branch
programs with recovery patterns are the main mitigations.

### 4.3 Error handling

The runner wraps each tool call and surfaces errors as thrown values, not silent failures.
The model is expected to write `try/catch` where it needs to distinguish error cases.
Unhandled throws terminate the branch and are reported as an error result.

### 4.4 State

Each branch program is a fresh function; its local variables do not survive the call. To carry
data across branch calls without routing it through the model's context, the runner passes a
`state` object as the second parameter.

- `state` is a plain object (`Record<string, unknown>`). The program reads and writes it directly:
  `state.files = await Promise.all(...)`.
- The layer above owns `state` and decides its lifetime (e.g. per task or per session). The runner
  only passes it through; it is mutated in place and kept even if the branch fails.
- `state` is invisible to the model unless reported, so every trace ends with a **state footer**
  listing its keys and value sizes (see §7.3).
- Values should be JSON-serialisable so state can be logged, snapshotted, and size-reported.

**Prefer references over copies.** A copy of a file or symbol goes stale when something else
changes it. Where possible, store a *reference* (where the thing lives, plus a version such as a
content hash) and resolve it when needed:

```ts
state.parser = await tools.refSymbol({ file: "src/a.ts", name: "parseConfig" });
// later branch:
const { text, stale } = await tools.resolve({ ref: state.parser });
```

- Locate by stable identity (file + symbol path), not line ranges, which shift on edit.
- Resolving reads the current content; a version mismatch marks the result `stale: true`.
- A reference whose target was deleted or renamed throws a clear `RefNotFound` error when resolved.
- Values with no source to re-read (command output, LLM responses) are snapshots, and should be
  stored with when they were taken.

Creating and resolving references is a tool concern (§6), not a runner concern; the branch spec
only requires that state stays inspectable through the footer. With no state tools, `state` still
works as a plain cache.

---

## 5. Runner

The runner receives a branch program string, compiles it, and executes it against a `Tools` map.

### 5.1 Execution

1. Parse the string into a callable `async (tools, state) => { ... }` via `new Function` or equivalent.
2. Inject the tool map and the state object.
3. Execute with an optional `AbortSignal` for timeout and an optional `onEvent` callback (§5.4).
4. Return a `BranchResult`. Both variants carry the execution trace (§7):
   - **Success:** `{ ok: true, value: unknown, trace }`
   - **Failure:** `{ ok: false, error: string, message: string, line?: number, aborted?: boolean, trace }`

### 5.2 Isolation

The runner itself is **not sandboxed**. Tool isolation is the responsibility of the environment:

- In production/MCP contexts, the environment may wrap tools with path containment, resource limits, or network restrictions before passing them to the runner.
- In eval/test contexts, tools are passed as-is; the operator accepts the risk.

This is an explicit design choice: sandboxing (VM, worker thread) prevents synchronous infinite loops
from being interrupted cleanly and adds complexity. The tradeoff is accepted.

_Open: revisit isolation separately from experiment reproducibility. In experiments, branch runs
inside the job's container via the tool server (framework-runner §6.4); whether branch programs
need their own isolation outside experiments (path containment, resource limits) is still undecided._

### 5.3 Abort

The caller passes an `AbortSignal`. Tools receive the signal via their closure and are expected to
honour it (e.g., kill a spawned process). The runner sets a keepalive timer while a tool is awaited
and clears it when the branch finishes, ensuring the process does not exit prematurely.

On abort, timeout, or an unhandled error, the runner returns the **partial trace** recorded up to
that point, so the model can see which calls completed and which side effects may have happened.

### 5.4 Live events

The caller may pass `onEvent(event)`. The runner invokes it synchronously for each trace event
(§7.1) as it is recorded, so a harness can show progress during long branches. Errors thrown by
`onEvent` are ignored and do not affect the branch. How progress is displayed is up to the harness.

The model itself never sees events mid-branch; reacting to them would be a new turn.

---

## 6. Tools

The `Tools` map passed to a branch program is assembled by the layer above the runner.
The runner has no opinion on which tools exist or what they do.

### 6.1 Tool contract

Every tool follows a **single calling convention**: it takes one argument object and returns
a value (sync or async).

```ts
type Tool = (args: Record<string, unknown>) => unknown | Promise<unknown>;
type Tools = Record<string, Tool>;
```

- The argument is always a single object, even for one-parameter tools: `tools.readFile({ path })`.
  Tools with no parameters take `{}`. Optional parameters are optional keys.
- The return value may be any JSON-serialisable value (string, object, array, …). Structured
  results are preferred over strings that the model must parse, e.g. `bash` returns `{ code, out }`.
- Failures are signalled by throwing (see §4.3). A thrown error should carry a short, specific message.

The same convention applies to framework-native tools and adapted harness tools (§6.3), so the
model learns one calling style and the trace (§7) renders all calls the same way.

### 6.2 Registering tools

Each tool is registered with:

| Field | Meaning |
|-------|---------|
| `name` | Key in the `Tools` map; a valid JS identifier |
| `description` | One or two lines on what it does and when to use it |
| `parameters` | JSON Schema for the argument object |
| `fn` | The implementation, following §6.1 |
| `returns` *(optional)* | TS type of the return value; `unknown` if omitted |

The framework builds the `Tools` map and the model-facing declarations (§6.4) from these entries.
Name collisions are rejected at registration time.

### 6.3 Harness adapter

Implementations should expose **all tools available in the host agentic harness** inside branch,
not only framework-native ones. Harness tools (MCP servers, OpenAI/Anthropic function-calling tools)
already have a name, description, and JSON Schema for a single argument object, so they fit §6.2 directly.

The adapter:

1. Reads each harness tool's name, description, and input schema.
2. Normalises the name to a valid JS identifier (e.g. `mcp__github__create_issue` → `github_createIssue`);
   the mapping is shown in the declarations.
3. Wraps the call so that `tools.x(args)` invokes the harness tool with `args` and resolves to its result.
   Harness error results (e.g. MCP `isError: true`) are converted to thrown errors.
   Text-only results are returned as strings; results that are JSON are parsed.
4. Passes the `AbortSignal` (§5.3) through to the harness call where the harness supports cancellation.
5. Registers the wrapped tool via §6.2.

The `branch` tool itself is not exposed inside branch programs (no recursion).

### 6.4 Declarations shown to the model

The model can only call tools correctly if it knows their signatures. The framework generates a
TypeScript declaration block from the registered tools (JSON Schema → TS type) and includes it in
the `branch` tool's description:

```ts
/** Read a file as UTF-8 text. */
readFile(args: { path: string }): Promise<string>;
/** Run a shell command. */
bash(args: { cmd: string; timeoutMs?: number }): Promise<{ code: number; out: string }>;
```

### 6.5 Responsibilities of the layer above

- Choosing which registered tools to pass for a given call (all of them by default).
  Why and how a subset is chosen is outside this spec.
- Wrapping tools with containment, rate limiting, cost accounting, or tracing.
- Injecting the `AbortSignal` via closure.

---

## 7. Execution trace

After the branch finishes (success or failure), the runner returns a **structured execution trace**
to the model instead of the raw return value. The trace is deterministic: it is produced by the
runner from recorded events, with no LLM pass.

The original program text is **not** re-sent to the model. It is already in the conversation as the
model's own tool-call argument, so the trace refers to it by line number.

### 7.1 Events

The runner records an ordered event stream:

| Event | Fields | Captured by |
|-------|--------|-------------|
| `call` | call id, line, tool name, compact args, ok/error, truncated result, duration | Proxy around the `Tools` map (no source rewrite) |
| `cond` | line, kind (`if` / `else` / ternary / `switch` case / `catch`), boolean result | AST instrumentation |
| `loop` | line, iteration count, summary of events inside | AST instrumentation |
| `log` | line, message | `console` injected by the runner |
| `return` | line, compact value | AST instrumentation |
| `error` | message, branch-code stack (lines only), throwing tool if any | Stack mapping |

The *hot path* (the sequence of branches actually taken) is the ordered sequence of `cond` events,
so no separate step is needed to compute it.

### 7.2 Instrumentation

Before execution, the runner parses the program with the TypeScript compiler API and rewrites
control-flow points to call a trace recorder, e.g. `if (c)` → `if (__t.cond(L, "if", c))`.
Line numbers come from **original AST positions**, not from the generated code, so instrumentation
does not shift the lines reported to the model.

Stack traces are filtered to frames inside the branch program (identified by `sourceURL`) and
mapped back to original lines. Frames from the runner, the tools, and Node internals are dropped.
The tool that threw (if any) is named from the matching `call` event.

Not instrumented initially: short-circuit operators (`&&`, `||`, `??`) and optional chaining (`?.`).
These are frequent and produce noise; they can be added later if traces prove ambiguous.

### 7.3 Rendering

The default rendering is a compact line-prefixed log:

```
L3  bash({cmd:"find . -name happy.py"}) → {code:0, out:""} (12ms)
L4  if (!result.out.trim()) → true
L5  bash({cmd:"find / -name happy.py"}) → {code:0, out:"/home/user/happy.py"} (840ms)
L6  return {found:true, path:"/home/user/happy.py"}
```

On failure:

```
L9  readFile({path:"cfg.json"}) ✗ ENOENT: no such file or directory
    at L9 ← L14 ← L20
```

Loops are collapsed:

```
L12–15  for ×50 (48 ok, 2 err)
        L13 readFile ✗ ENOENT ×2 (iterations 7, 31)
```

Concurrent calls (e.g. under `Promise.all`) carry their call id, and are ordered by start time,
with completion shown on the same line.

On abort or timeout, the trace ends with the point reached and calls still in flight:

```
L7  runTests({}) … aborted after 120000ms (in flight)
    [aborted: timeout]
```

Every trace ends with the state footer (§4.4), omitted when `state` is empty:

```
state: files(10 items, 42KB), parser(ref src/a.ts#parseConfig), plan(string, 310B)
```

### 7.4 Size limits

- Each tool result and return value is truncated (default 200 chars) with a `…(+N chars)` marker.
- Loops with more than a few iterations are collapsed as above; only distinct errors are listed.
- The whole trace has an event budget; events past it are replaced by `…N events elided`, but the
  final `return` or `error` event is always kept.

### 7.5 Alternative renderings

The same event stream can be rendered differently. The eval harness exposes
`--branch-context trace|annotated|full` so the options can be compared experimentally:

| Option | Tokens added per turn | Notes |
|--------|-----------------------|-------|
| **trace** (default) | Low; grows slowly thanks to collapsing and caps | Refers to the program by line number |
| **annotated** | Medium; full program source plus inline comments | Projects events onto source lines (`// → value`, `// [taken]`, `// [returned]`, `// [error: …]`); weak for loops, because one line can run many times; re-sends the program |
| **full** | High; grows with branch complexity | Untruncated tool outputs; useful as an upper bound in experiments |

A prose (natural-language) summary is **not** offered: it is lossy and would need a second model pass.

The full, untruncated event stream is also kept in the run output so the experiment viewer can show it.

---

## 8. Mode interaction

How experimental modes use (or don't use) the branch tool is described in the mode specs, not here.
This spec covers only the branch tool itself.

---

## 9. Out of scope

- Policy for choosing a subset of registered tools for a given call (see §6.5).
- The model reacting to events mid-branch (any reaction is a new turn; see §5.4).
- How progress events are displayed (§5.4).
- Concrete reference/resolve tools for state (§4.4); these belong to the tool layer.
