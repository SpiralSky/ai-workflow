# Architecture: Tool Registry, Hosts and Wrappers

**Derived from:** [branching-framework.md §6](../features/branching-framework.md),
[harness-integration.md §4](../features/harness-integration.md), [tools.md §3–4](../features/tools.md),
[orchestrate.md §6](../features/orchestrate.md)  
**Package:** `@aiw/core` → `src/registry/`, `src/host/`

---

## 1. Overview

```
Host (executes)  ──tools()──▶  Registry (ToolDecl + metadata)  ──▶  declarations (TS / JSON Schema)
      ▲                                                         ──▶  selection index (orchestrate)
      │ call(req, ctx)
Wrapper stack (check → report → cap) ◀── Tools map (fn per name) ◀── runBranch / executor / server
```

The core never owns tool implementations. It owns the **description** of tools (registry), the
**text** generated from them (declarations), and the **path** a call takes to a host.

---

## 2. Registry

```ts
interface ToolDecl {
  name: string;                 // valid JS identifier (normalised, §3)
  hostName: string;             // the name the host knows (e.g. "mcp__github__create_issue")
  description: string;
  parameters: JSONSchema;       // single object argument
  returns?: string;             // TS type text, "unknown" if omitted
  routing: "routed" | "direct";
  meta: SelectionMeta;          // orchestrate §6: whenToUse, whenNotToUse, examples, category,
                                //   effect, requires, cost
}
```

- Built from `host.tools()`. Duplicate normalised names are a registration error (§6.2).
- `effect` defaults to `write` when unknown (safe default for parallelism and read-only mode).
- `whenToUse` defaults to the description when missing (orchestrate §6).
- **Similarity warning** (orchestrate §6.1): at registration, cosine similarity of BM25 term
  vectors over indexed text; pairs above 0.8 are logged as warnings (never errors).

---

## 3. Harness-tool adaptation

Implements branching-framework §6.3 once, for every host:

| Step | Rule |
|------|------|
| Name | `mcp__<server>__<tool_name>` → `<server>_<toolName>`; other names camel-cased; non-identifier characters dropped; collisions get a numeric suffix and are reported. The mapping is kept in `ToolDecl.hostName` and shown in declarations as a comment. |
| Errors | MCP `isError: true` → throw `Error(text)`; transport errors → throw `HostError` (distinguished for infra classification, [runner §7](runner.md#7-retries-budget-validity)). |
| Results | Single text content: JSON-parse if it parses to an object/array, else return the string. Multiple content items → array. Structured content (`structuredContent`) wins when present. |
| Abort | `ctx.signal` forwarded as MCP request cancellation. |

---

## 4. Host interface

As harness-integration §4.1, with the call context made explicit:

```ts
interface Host {
  tools(): Promise<HostToolDecl[]>;
  call(req: { id: string; parent: string; name: string; args: unknown },
       ctx: { signal: AbortSignal; pauseTimeout(): () => void }): Promise<unknown>;  // throws
  close(): Promise<void>;
}
```

- `id` is the inner-call id (= its telemetry event id, so the host's own logs and the event tree
  correlate). `parent` is the event id of the enclosing framework call (`branch` / `do`).
- `pauseTimeout()` returns a resume function; hosts call it around approval waits (A-23).
- Host implementations live in `@aiw/server`, not in core ([framework-server §3](framework-server.md#3-hosts)).
  Core ships only `CompositeHost` (merges several hosts, first-wins on name) and the
  `CheckedHost` wrapper (§5) because their semantics are part of the core contract.

---

## 5. Wrapper stack

Every inner call passes through the same stack, outermost first:

| Layer | Owner | Does |
|-------|-------|------|
| Branch call proxy | core/branch | Trace `call` events, call id, line (core-branch §4) |
| `reportTool` | telemetry (`wrapTools`) | `toolStart` + `tool` events, durations ([telemetry §2](telemetry.md#2-reporter)) |
| `capOutput` | core | Enforce the tool output cap (tools §4, default 8 KB) for host tools that do not cap themselves; appends the truncation note |
| `CheckedHost` | core | Runs `check(call) → allow | deny | ask (+ modified args)` before the call (harness-integration §6.2). Deny throws `denied: <reason>` into the program. Ask → `approve()` callback supplied by the server (elicitation), with `pauseTimeout` around it |
| `Host.call` | server | Executes |

In the runner the check layer is absent (`LocalHost` with no checks); in harnesses it is the policy
or the mirrored adapter ([framework-server §5](framework-server.md#5-check-step-and-policy)).

---

## 6. Framework tool assembly

`buildFramework(kind, registry, opts)` returns the direct tools the model sees and their handlers.
One function per framework, used by the server in every host configuration:

| Framework | Model-facing tools | Inner `Tools` map |
|-----------|--------------------|-------------------|
| `baseline` | every routed tool as its own MCP tool (JSON Schema, same description) | — |
| `branch-only` | `branch` | all routed tools |
| `orchestrate` | `do`, `resolve` | per executor: shortlist + `findTools`, `resolve`, `save`, `refSymbol` ([orchestrate-engine](orchestrate-engine.md)) |

The prompt section for each framework is a static Markdown file in `@aiw/core/prompts/<framework>.md`
delivered as the server's MCP `instructions` (harness-integration §9.1) and as the system-prompt
section in the runner. Its hash plus the hash of the generated tool list is the framework's
provenance fingerprint (framework-runner §7.1).

### 6.1 Declarations

`declarations(decls: ToolDecl[]): string` converts JSON Schema → TS with an in-house converter
supporting the subset used by the catalog and typical MCP tools: object, array, string/number/
integer/boolean/null, `enum`, `const`, `anyOf`/`oneOf` (union), `required`, `description` (as JSDoc),
`additionalProperties`. Unsupported constructs degrade to `unknown` with a comment, never fail.
Output is sorted by catalog order (not alphabetically) so tier S tools come first.

### 6.2 Description length caps

When a harness caps description length (harness-integration §5.1), `declarations` takes a
`maxChars` and an ordered priority list; declarations past the cap are replaced by a single line
naming them and pointing to the read-only `tools` inner call (`tools.tools({ names? })` returns
full declarations). The priority list is a per-plugin setting.
