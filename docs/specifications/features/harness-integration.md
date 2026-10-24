# Feature: Harness Integration

**Area:** Distribution / real-world use  
**Related:** [branching-framework.md](branching-framework.md), [orchestrate.md](orchestrate.md),
[references.md](references.md), [framework-runner.md](framework-runner.md), [tools.md](tools.md)

This spec has two parts:

- **Part A (§1–§12): general.** Harness-agnostic core, hosts, server, permissions, plugins.
  Nothing in Part A depends on a particular harness.
- **Part B: Claude Code support.** The Claude Code plugin and its check adapter, built only from
  the interfaces Part A defines. Other harnesses get their own Part when wanted.

---

# Part A — General

## 1. Summary

Frameworks (branch, orchestrate) are standalone tool interfaces. This feature lets people use them in
real agent harnesses and any MCP client without reimplementing them per harness.

The model sees the framework's tools (`branch`; `do` + `resolve`) instead of the harness's
ordinary tools. Those ordinary tools (built-ins and user-added tools) are **routed**: callable only
from inside the framework, and every call a program makes still gets the harness's own checks
(permission rules, hooks, approval prompts) — by the harness itself where it can execute for the
framework, otherwise applied by the framework on its behalf. This holds because branch programs
run in an isolate whose only way out is a tool call ([branching-framework §5.2](branching-framework.md#52-isolation)).

Three parts:

1. **Framework core** — harness-agnostic. Never executes tools itself; sends every inner call to a
   **host** (§4).
2. **Hosts** — what executes inner calls: the harness itself where it allows it (**native host**);
   the framework applying the harness's own rules, hooks and approval prompts where the harness
   exposes those but cannot execute for it (**mirrored host**); the runner's own
   loop; or the framework with its own policy (**MCP fallback**).
3. **Harness plugins** — thin, per-harness packages: register the framework, install its prompt
   section, route the harness's tools, and connect a native host where the harness supports one.
   No framework logic.

---

## 2. Motivation

- The experimental claim (framework-runner §2) only matters if the frameworks can be used where
  people actually work.
- Users extend harnesses with their own tools and permission rules. A framework that runs those
  tools behind the harness's back either loses them or bypasses the user's rules. Routing calls
  back to the harness keeps both.
- Hiding ordinary tools from the model removes the choice between a built-in call and a program;
  the model always writes a program, which is the behaviour that was measured (`branch-only`).
- Keeping logic in the core means behaviour in a harness matches what was measured: the same core,
  prompt sections and declarations (framework-runner §7.1 hashes).

---

## 3. Concepts

| Term | Meaning |
|------|---------|
| **Harness** | As in framework-runner §3: the agent loop the user runs. |
| **Host** | Whatever executes inner calls and owns their permissions and logging (§4.1). |
| **Inner call** | A tool call made by a branch program or an orchestrate executor, not by the model directly. |
| **Routed tool** | Callable only as an inner call; not in the model's tool list. |
| **Direct tool** | Stays in the model's tool list (framework tools, harness control tools). |
| **Framework server** | MCP server exposing the framework tools to a harness. |
| **Plugin** | Per-harness package (§9). |

---

## 4. Core and host

### 4.1 Host interface

The core receives a host and never runs tools itself:

```ts
interface Host {
  tools(): ToolDecl[];   // name, description, JSON Schema, routed | direct
  call(req: { id: string; parent: string; name: string; args: unknown },
       ctx: { signal: AbortSignal }): Promise<unknown>;   // throws on failure or denial
}
```

- `parent` is the id of the framework call (`branch` / `do`) the inner call belongs to, so the host
  can tag it in its transcript ("called by branch #12").
- The core adapts host tools exactly as branching-framework §6.3 describes (name normalisation,
  error → throw, JSON parsing) and builds the declarations from `tools()` (§6.4 there).
- Orchestrate executors call tools through the same interface, and tool selection (orchestrate §7)
  runs over `tools()`.

The pattern — code-originated tool calls handed back to the agent loop, executed there without a
model turn, tagged with their caller — is the same one the Anthropic API calls *programmatic tool
calling*.

### 4.2 Routed and direct tools

| Kind | Default membership |
|------|-------------------|
| **Routed** | Harness built-ins for files, search and shell; user-added tools (MCP servers). |
| **Direct** | Framework tools; harness control tools that only make sense from the model (subagents, task lists, asking the user, plan-mode switches). |

Routed tools appear only as declarations inside the `branch` description. Plugins may adjust the
split per harness. A tool the framework cannot reach (e.g. a remote connector whose credentials
live in the harness) stays direct, so nothing the user has becomes unusable. A tool the host cannot hide from the model stays visible but the prompt section
tells the model to call it through `branch`.

### 4.3 Host kinds

| Host | When | Executes inner calls | Permissions and logging |
|------|------|---------------------|-------------------------|
| **Native** | Harness meets the requirements in §4.4 | The harness | The harness's own, per inner call |
| **Mirrored** | Harness can't execute for the framework, but its rules, hooks and tool implementations are reachable (§6.2) | The framework server, using the harness's own tool implementations where available | The harness's rules and hooks, evaluated by the framework; approvals through the harness's elicitation dialog (§7.2) |
| **Runner** | Experiments | The runner (its tool server in the job container) | Runner records each call as a child `tool` event (framework-runner §4.5) |
| **MCP fallback** | Generic MCP clients, or harnesses with neither of the above | The framework server (§6.1) | Framework policy (§7.3); the harness sees only the framework call |

The core is identical in every host kind; only the host differs.

### 4.4 What a native host needs from a harness

1. **List** its tools with schemas, including user-added ones.
2. **Execute** a tool call that did not come from a model turn, applying its permission rules and
   recording it, then return the result.
3. **Hide** a tool from the model while keeping it executable.

1 + 2 are required for a native host. Without 3 the tools stay visible (§4.2). Which harnesses meet
these is verified per harness at implementation; until one is confirmed, MCP fallback is the
guaranteed path everywhere.

### 4.5 Call channel

When the core runs in a separate process from the host (e.g. the framework server and a native
host in the harness process), inner calls travel over a bidirectional channel opened by the plugin:
request `{ id, parent, name, args }`, response `{ id, ok, value | error, durationMs }`, plus
`cancel { id }`, and `pause { id }` / `resume { id }` so a host in another process can stop and
restart the branch timeout while it waits for approval (§4.6). In-process hosts use direct calls. The protocol is part of the core, not of any
plugin.

### 4.6 Timeouts and waiting

An inner call may wait on the user (an approval prompt). Time spent waiting for approval does not
count towards the branch timeout (branching-framework §5.3); cancelling the framework call cancels
outstanding inner calls.

---

## 5. Framework server

### 5.1 Exposed tools

| Framework | Tools | Notes |
|-----------|-------|-------|
| branch | `branch` | Description carries the declarations of routed tools. |
| orchestrate | `do`, `resolve` | As orchestrate §4.1. The harness's main model is the planner. |

The names, descriptions and declarations are the same strings the runner uses, so a framework's
prompt hash (framework-runner §7.1) identifies it in both places.

Harnesses may cap tool description length (per-harness limits are in that harness's Part). With
many routed tools the declarations can exceed it. The `branch` description then carries the most-used declarations plus a note, and the
full set is available from a read-only `tools` inner call (or an MCP resource) that the model can
query from a program. Which declarations go upfront is a per-plugin setting.

### 5.2 Mapping MCP features onto the core

| Core concept | MCP mechanism |
|--------------|---------------|
| Abort (branching-framework §5.3) | Request cancellation → `AbortSignal`; the partial trace is still returned. |
| Live events (branching-framework §5.4) | Progress notifications, when the client sends a progress token. Throttled; never required. |
| Tool failure (branching-framework §4.3) | Tool result with `isError: true` carrying the failure text and partial trace. |
| Workspace root | The client's roots if provided, else a configured root. |

### 5.3 Session state

The server lives for one harness session. Branch state (branching-framework §4.4) and saved
references (references.md §7) live for that session and are lost when it exits (cross-session:
references.md §9 Q3).

### 5.4 Output size

The server applies the framework's own caps (branching-framework §7.4, orchestrate §8.3) and never
relies on the harness to truncate.

---

## 6. Framework-executed hosts

### 6.0 Why routing through MCP isn't enough

A harness checks the tool calls **it makes**: model → harness (permission rules, hooks, approval
prompt) → tool or MCP server. A user's MCP tools are checked when the model calls them directly.
A branch program's calls start inside the framework server, after the harness has already approved
the `branch` call; MCP has no request for a server to send a call back through its client, so the
harness never sees them. Making the tools MCP servers does not change the direction of the call.

So where the harness can't execute for the framework (§4.4), the framework executes, and the
question is only whose rules it applies.

### 6.1 MCP fallback

The server executes inner calls itself:

| Tool source | How |
|-------------|-----|
| Harness built-ins | Equivalents from tools.md tier S (L where configured), contained to the workspace root. |
| User-added MCP servers | **Config discovery**: the plugin names the harness's MCP config locations; the server opens its own connection to each. Servers added later appear next session. |
| Harness-held connections (remote connectors whose credentials live in the harness) | Not reachable unless the user authenticates the server separately. |

Built-ins are hidden from the model by the plugin through the harness's settings (§9.2), since the
server cannot route to them. Generic MCP clients without a plugin cannot hide them; the prompt
section asks the model to use `branch`.

### 6.2 Mirrored host

For harnesses that expose their checks and tools even though they can't execute for the framework.
The framework executes, but every inner call goes through the **same** decisions the harness would
make for a direct call. The adapter for a harness provides:

| Piece | Purpose |
|-------|---------|
| **Tool source** | The harness's own tool implementations if it can serve them (so behaviour is identical), plus user MCP servers by config discovery (§6.1). |
| **Name mapping** | Inner name ↔ the harness's tool name, so rules written for the harness match (`bash` ↔ `Bash`, `github_createIssue` ↔ `mcp__github__create_issue`). |
| **Rule evaluator** | Reads the harness's permission rules from all its settings scopes and evaluates allow / deny / ask per inner call with the harness's matching semantics. |
| **Hook runner** | Runs the user's pre-tool hooks with the harness's input format; their allow / deny / ask / modified-args decisions apply. Post-tool hooks run after the call. |
| **Approval** | "ask" → MCP elicitation, which the harness shows as its own dialog. Time spent waiting doesn't count (§4.6). |
| **Session context** | Facts the rules depend on that only the harness knows (e.g. current permission mode, session id). Obtained from the harness where it exposes them, e.g. through a hook on the framework call. |

The core defines the check step (`check(call) → allow | deny | ask`, with optional modified args)
and runs it before every inner call; an adapter only supplies the pieces above. Part B is the
Claude Code adapter.

Risk: the evaluator reimplements the harness's matching rules and can drift from it. Adapters are
pinned to a harness version and tested against a fixed table of rules and calls.

---

## 7. Permissions

### 7.1 Native host

Each inner call goes through the harness's permission check like any direct call: the user's
existing rules (allow / deny / ask) apply per inner tool, and "ask" prompts the user mid-program
(§4.6). A denial is thrown into the program as an error and appears in the trace.

The framework call itself is also a tool call. Recommended setting: allow `branch` / `do`
automatically and rely on per-inner-call rules, to avoid approving twice. The plugin documents this;
it does not change the user's rules.

### 7.2 Mirrored host

Inner calls are checked by the harness's own rules and hooks, applied by the framework (§6.2).
"ask" opens the harness's elicitation dialog. Same recommendation as §7.1 for the framework call
itself.

### 7.3 MCP fallback

The harness approves only the framework call; its argument is the program source, so an "ask"
prompt shows what will run. Inner calls are checked by a framework policy file (workspace
containment; allow / deny / ask for inner tools and `bash` command patterns; destructive patterns
denied by default). An "ask" inner call is put to the user through MCP elicitation where the client
supports it, and denied otherwise.

When no rule matches: read-effect tools inside the workspace are allowed, `write` and `exec` tools
ask, and anything outside the workspace or matching a destructive pattern is denied.

### 7.4 Read-only mode

A flag that denies inner calls to tools whose effect is not `read`, for harness modes such as plan
mode. Declarations stay unchanged, so the prompt cache is not invalidated when the mode toggles.

---

## 8. Nested LLM calls (orchestrate)

The executor needs its own model. The harness does not lend its model to an MCP server in general,
so the framework makes its own calls through an OpenAI-compatible endpoint and key configured for
it (e.g. OpenRouter). Same client as the runner, so usage and cost are reported identically
(framework-runner §4.1). The executor's tool calls are inner calls and go through the host (§4.1).

- **Executor model is configurable** and may differ from the harness's model.
- **In evaluation, executor and main model are the same** (framework-runner §4.4 records the model
  per role; a run with differing models is a separate condition).

If no endpoint is configured, orchestrate is unavailable and the framework says so at startup;
branch needs no LLM.

---

## 9. Harness plugins

### 9.1 Support levels

| Level | What the client gets | Examples |
|-------|----------------------|----------|
| **Generic MCP client** | Framework server with MCP fallback host. Works with no plugin: the prompt section is carried in the server's MCP `instructions` and tool descriptions; root and policy come from server args/env. | AnythingLLM agents, any MCP-capable chat app or IDE |
| **Plugin, fallback host** | As above, plus config discovery, built-in hiding, prompt files, hooks. | Any plugin harness failing §4.4 |
| **Plugin, mirrored host** | Harness's own rules, hooks, approval dialog and (where served) tools (§6.2). | Claude Code (Part B) |
| **Plugin, native host** | Routing through the harness (§4). | Plugin harnesses meeting §4.4 |

The generic level is the compatibility floor. Clients that are not coding harnesses (e.g.
AnythingLLM) have no natural workspace, so the root must be set explicitly.

### 9.2 Plugin contents

1. Framework registration (server command and env: endpoint/key for §8, framework choice).
2. Prompt section, as the harness's instruction/skill file.
3. Routing: hide routed tools from the model (§4.2) through the harness's settings.
4. Host: native host connection (§4.5) where the harness supports it; otherwise MCP config locations
   for fallback discovery (§6).
5. Optional hooks.

Expected packaging for harnesses without their own Part yet (unverified):

| Harness | Packaging | Instructions | Hiding tools | Host |
|---------|-----------|--------------|--------------|------|
| opencode | Plugin / MCP entry in config | `AGENTS.md` / agent definition | Per-agent tool toggles | To verify (in-process JS plugins) |
| Codex CLI | MCP entry in config | `AGENTS.md` section | Config, where supported | To verify |
| Gemini CLI | Extension (manifest + MCP servers + context file) | Extension context file | Extension tool exclusion list | To verify |

Formats are checked per harness version when that harness gets its Part, and pinned in its plugin.
Claude Code (Part B) is the only planned plugin; others run at the generic level until wanted.

### 9.3 Versioning

A plugin pins the framework version it was built for. The framework reports its version and prompt
hash at startup, so a mismatch between plugin prompt files and declarations is detectable.

---

## 10. Telemetry

Frameworks report through the shared reporter and sink as in the runner (framework-runner §5.2–5.3).
Default off; a path setting turns on the JSONL sink.

- With a native host, inner calls are also in the harness's own transcript, tagged with `parent`.
- Per-harness transcript importers (merging harness turns with the sink) and per-harness cost
  displays for orchestrate's executor spend are **deferred**; both are harness-specific.

---

## 11. Out of scope

- Driving harnesses from the runner (headless runs as experiment conditions), per
  framework-runner §8.
- Harness features beyond §9.2: custom UIs, status lines, IDE integration.
- Cross-session persistence of state and references (§5.3).
- OS-level sandboxing beyond the branch isolate and workspace containment (branching-framework §5.2).
- Harnesses without MCP support and without a native host.

---

## 12. Open questions

1. **Native host availability.** No harness is confirmed to meet §4.4. opencode (in-process JS
   plugins) is the most likely native host and needs a check when a plugin for it is wanted.
2. ~~**Discovery duplicates** (§6).~~ Decided 2026-10-23: HTTP/remote servers are excluded by default, stdio
   servers included; a per-server allow/deny list overrides (architecture/framework-server I-09).

---

# Part B — Claude Code support

Claude Code is supported as a **mirrored host** (§6.2) through a Claude Code plugin. Everything here
plugs into Part A interfaces; removing Part B changes nothing in Part A. Facts below were checked
against the Claude Code docs in 2026-10; the plugin pins the Claude Code version it was tested on
(§9.3).

## B1. Plugin layout

| File | Contents |
|------|----------|
| `.claude-plugin/plugin.json` | Name, version, `userConfig` (framework choice; endpoint, API key (sensitive) and executor model for orchestrate, §8), and the framework server under `mcpServers` (started from `${CLAUDE_PLUGIN_ROOT}`; config values passed through `${user_config.*}` in `env`). |
| `hooks/hooks.json` + `hooks/register.ts` | A Claude Code **hooks module** that reads the framework choice from `userConfig` and: adds the framework's prompt section to the system prompt (`prompt.compose`); routes tools (B2); attaches session context to framework calls (B4). |

No main-thread agent or plugin `settings.json` is used: plugin settings are static and cannot follow
`userConfig`, and an agent's `tools` list is fixed when the plugin is built.

The plugin name must not start with `claude-` or `anthropic-` (reserved). The framework's MCP tool
then appears to Claude Code as `mcp__plugin_<plugin>_<server>__branch`.

## B2. Routing (hiding tools from the model)

Plugins cannot ship permission rules, and the routed set (user MCP servers) is only known at
runtime, so routing is done by the hooks module, decided per call:

- **Direct:** the framework tools; Claude Code control tools (subagents, task lists, asking the
  user, plan mode, skills); tools the framework can't reach (§4.2), such as claude.ai connectors.
- **Routed:** file, search and shell built-ins, and every user MCP server the framework server
  discovered and reaches (it publishes this list at startup). A direct call to a routed tool is
  denied in `tool.call` with a message saying to call it from a program. `tool.describe` moves
  routed tools behind ToolSearch so their schemas are not sent every turn; a module cannot remove a
  tool from the list, so the deny is the enforcement.

The framework's own inner calls go through its `claude mcp serve` client, not through the model's
tool calls, so routing never blocks them. The user's own permission rules are untouched and apply
to inner calls (B4).

## B3. Tool source

- **Built-ins:** the framework server starts `claude mcp serve` as an MCP client and routes its
  tools, so file, search and shell behave exactly as in Claude Code. That mode performs no
  confirmation itself, so the B4 checks are the only ones and always run first. If it is
  unavailable, the server falls back to the tools.md catalog equivalents.
- **User MCP servers:** discovered from Claude Code's MCP config: user/local scope, project
  `.mcp.json`, servers from other enabled plugins, and managed MCP config. Started as second
  instances (§12 Q2).
- **Workspace root:** from MCP roots if Claude Code provides them, else the project directory passed
  in the server's `args`.

## B4. Checks (the Claude Code adapter for §6.2)

Run before every inner call, in this order; the first deny wins.

1. **Name mapping.** Inner name → Claude Code tool name (`bash` → `Bash`, `readFile` → `Read`,
   discovered tools → `mcp__<server>__<tool>`), so the user's rules and hook matchers match.
2. **Hooks.** The user's `PreToolUse` hooks (all settings scopes and enabled plugins) whose matcher
   matches, given Claude Code's input (`session_id`, `transcript_path`, `cwd`, `permission_mode`,
   `hook_event_name`, `tool_name`, `tool_input`, a generated `tool_use_id`). Their
   `permissionDecision` (allow / deny / ask), `updatedInput` and exit code 2 (block) apply. A hook
   `allow` skips the ask but not deny rules. `PostToolUse` hooks run after the call.
3. **Permission rules**, checked on the final (hook-updated) input. `permissions.deny / ask / allow`
   from managed, user, project and local settings, with Claude Code's precedence (deny > ask >
   allow) and pattern syntax (e.g. `Bash(npm run test:*)`, `Read(./secrets/**)`).
4. **Permission mode.** From session context: `plan` → read-only (§7.4); `dontAsk` → ask becomes
   deny; `bypassPermissions` → rules still apply but no prompts; `acceptEdits` → file edits allowed
   without asking.
5. **Ask.** Shown through MCP elicitation, which Claude Code renders as a dialog (tool, arguments,
   the rule that asked). Accept runs the call; decline throws into the program. Waiting time is not
   counted (§4.6).

**Session context.** The hooks module's `tool.call` hook on the framework tool passes the session's
`permission_mode`, `session_id` and `transcript_path` to the server before each framework call.

**The framework call itself.** Plugins can't add allow rules, so first-run instructions suggest
the user allow `mcp__plugin_<plugin>_<server>__branch` and rely on the inner checks (§7.1).

**Drift.** Steps 1–4 reimplement Claude Code's matching. The adapter has a test table (rules,
modes, hooks, calls → expected decision) that is rerun when the pinned Claude Code version
changes.

## B5. Limits

- **Description length.** ~4k characters for tools loaded upfront, ~16k for tools loaded through
  tool search. The `branch` tool sets `_meta["anthropic/alwaysLoad"]: true` so it is always
  visible, and its declarations fit 4k (§5.1).
- **Result size.** Results over 50k characters are saved to a file by Claude Code; error text over
  ~11k is truncated. The framework's own caps (§5.4) stay below both.

## B6. Telemetry

The session-context hook also provides `transcript_path`, which a later transcript importer and an
orchestrate cost display would use (§10, deferred).

## B7. Open questions

1. ~~**Subagents.**~~ Decided 2026-10-23: subagents are left unchanged; the plugin ships no subagent
   definitions. Revisit if subagent built-in use skews results (architecture/framework-server I-08).
2. **`claude mcp serve` details.** Exact tool list and behaviour (e.g. background commands) to be
   confirmed when building B3.
