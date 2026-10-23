# Architecture: Framework Server and Harness Plugins

**Derived from:** [harness-integration.md](../features/harness-integration.md)  
**Packages:** `@aiw/server` (binary `aiw-server`), `plugins/claude-code`

---

## 1. Process

`aiw-server` is a stdio MCP server built on the official MCP TypeScript SDK. One process per
harness session (harness-integration §5.3); in experiments, one per job (runner §5).

```
aiw-server --framework <variant> --host local|fallback|mirrored|native
           [--tier S|L] [--root <dir>] [--policy <file>] [--adapter claude-code]
           [--events <path> --transcript <path> --blobs <dir>]
           [--executor-model <m>] [--secondary-cap N] [--branch-context trace|annotated|full]
```

Startup: build host (§4) → registry from `host.tools()` → `buildFramework` (core-tools-and-hosts
§6) → advertise tools + `instructions` → log framework version and prompt fingerprint
(harness-integration §9.3). Orchestrate without `OPENAI_BASE_URL`/`OPENAI_API_KEY` → refuses that
framework at startup with a clear message (harness-integration §8).

---

## 2. MCP mapping

| Core concept | Server behaviour (harness-integration §5.2) |
|--------------|---------------------------------------------|
| Abort | `notifications/cancelled` → abort the call's `AbortController`; the partial trace is still returned |
| Live events | If the request has a `progressToken`: branch `onEvent` → `notifications/progress` with a one-line message, throttled to ≤ 2/s |
| Failure | `isError: true` with failure text + partial trace |
| Root | Client roots (`roots/list`) if offered, else `--root` |
| Telemetry parent | `_meta["aiw/parent"]`, `_meta["aiw/harnessId"]` if present ([telemetry §2](telemetry.md#2-reporter)) |
| Tool time | `_meta["aiw/durationMs"]` on every result |
| Infra error | `_meta["aiw/infraError"]: true` when a nested LLM call hit an infra error (runner §4.4) |
| Approval | `elicitation/create` (§5); unsupported → deny |

Output caps (§5.4) are applied by the framework (trace limits, report cap, tool caps) before the
result is returned.

---

## 3. Hosts

| Host | Implementation |
|------|----------------|
| `LocalHost` | Wraps `@aiw/tools` catalog for a tier, contained to the root. Used by the runner host and as the built-in source for MCP fallback. |
| `McpClientHost` | Connects as an MCP client to one server (stdio or HTTP) from a config entry; lists and calls its tools. Used for discovered user servers and `claude mcp serve`. |
| `CompositeHost` (core) | Merges hosts, first wins on name conflict, conflicts reported. |
| `CheckedHost` (core) | Applies a `Checker` before each call ([core-tools-and-hosts §5](core-tools-and-hosts.md#5-wrapper-stack)). |
| `ChannelHost` | Native host over the call channel (harness-integration §4.5): JSON lines `{ id, parent, name, args }` / `{ id, ok, value \| error, durationMs }` / `{ cancel: id }` over a socket path or fd given by the plugin. Built when a native-capable harness is confirmed (harness §12 Q1). |

---

## 4. Host compositions

| `--host` | Composition |
|----------|-------------|
| `local` (runner) | `LocalHost(tier)` — no checks; reporter only |
| `fallback` | `CheckedHost(PolicyChecker, Composite(LocalHost(S or configured tier), McpClientHost × discovered))` |
| `mirrored` | `CheckedHost(AdapterChecker(adapter), Composite(McpClientHost(harness tool server) or LocalHost(S), McpClientHost × discovered))` |
| `native` | `ChannelHost` (the harness applies its own checks) |

**Config discovery** reads the MCP config locations a plugin names (`--mcp-config <path>`
repeatable) and starts each server as a second instance. Servers whose transport is HTTP with
harness-held OAuth are skipped and stay direct (harness §4.2, §6.1).

> **Decided I-09 (2026-10-23):** Discovered servers run twice (harness §12 Q2). Decision: exclude HTTP/remote
> servers by default and include stdio servers; a per-server allow/deny list in the plugin config
> overrides.

---

## 5. Check step and policy

```ts
interface Checker {
  check(call: { name: string; hostName: string; args: unknown; effect: Effect },
        session: SessionContext): Promise<{ decision: "allow" | "deny" | "ask"; reason?: string;
                                            args?: unknown }>;
  after?(call, result): Promise<void>;   // post-tool hooks
}
```

- **PolicyChecker** (fallback, harness §7.3): policy file (JSON) with `root` containment, per-tool
  allow/deny/ask, `bash` command patterns, and a built-in deny list of destructive patterns
  (`rm -rf /`, `git push --force`, writes outside root, `curl … | sh`, …).
- **Read-only mode** (§7.4): `--read-only` or session context `plan` → any call with
  `effect ≠ read` is denied.

> **Decided I-10 (2026-10-23):** Harness/user tools without `effect` metadata default to `write`
> ([core-tools-and-hosts §2](core-tools-and-hosts.md#2-registry)), so read-only mode denies them.
> This matches Claude Code's plan mode, which runs only tools known to be read-only. Outside
> read-only mode they follow normal policy (ask unless allowed).

---

## 6. Telemetry and state in harnesses

- Reporter + file sink only when `--events` is set (harness §10). No runner exists, so the server's
  first `tool` event for a framework call is top-level and carries `harnessId` when the client
  sends it.
- Branch `state` and the reference store live for the server process (= harness session).

---

## 7. Claude Code plugin (Part B)

### 7.1 Bundle

```
plugins/claude-code/
  .claude-plugin/plugin.json   name "aiw" (not claude-/anthropic-), userConfig, mcpServers.aiw
  agents/branch.md, agents/orchestrate.md   main-thread agents (body = prompt section; tools = direct list)
  settings.json                { "agent": "aiw:branch" }   (or orchestrate, per userConfig)
  hooks/hooks.json             PreToolUse on mcp__plugin_aiw_aiw__(branch|do|resolve) → session-context hook
  hooks/session-context.mjs
  server/aiw-server.mjs        bundled server (same build as the job container)
```

The agent `.md` bodies are generated at build time from `@aiw/core/prompts/<framework>.md` so they
are byte-identical to what was measured (harness §2).

### 7.2 Routing (B2)

The agent `tools` list = framework tools + Claude Code control tools + unreachable tools.
Generated from a table in the plugin build; everything else is routed.

### 7.3 Tool source (B3)

`McpClientHost` over `claude mcp serve` (spawned by the server), mapped by the name table
(`bash ↔ Bash`, `readFile ↔ Read`, …). If `claude mcp serve` is unavailable, `LocalHost(S)`.
User servers from Claude Code MCP config locations (user/local, project `.mcp.json`, enabled
plugins, managed).

### 7.4 Session context

> **Decided A-22 (2026-10-23, approved):** The plugin's `PreToolUse` hook on the framework tools returns
> `updatedInput` adding `__session: { permission_mode, session_id, transcript_path, cwd }` to the
> tool input. The server strips `__session` before the call and uses it for the checks (B4 step 3–4
> inputs). This is race-free (context travels with the call) and needs no side channel.
> To verify at build time: `updatedInput` is applied to MCP tool calls, and the tool schema must
> allow the extra property (`additionalProperties: true`, not described to the model).
> *Alternative:* the hook writes context to a file keyed by session id under
> `${CLAUDE_PLUGIN_DATA}`, read by the server — needs the server to learn its session id.

### 7.5 `ClaudeCodeChecker` (B4)

Ordered steps exactly as B4: name mapping → permission rules (managed/user/project/local settings,
deny > ask > allow, Claude Code pattern syntax) → permission mode → `PreToolUse` hooks (spawned with
Claude Code's hook input JSON; `permissionDecision`, `updatedInput`, exit code 2) → ask via
elicitation. `PostToolUse` hooks in `after`. A table-driven test suite (rules, modes, hooks, calls →
decision) is pinned to the Claude Code version in `plugin.json` (B4 "Drift").

Limits (B5): the `branch` tool sets `_meta["anthropic/alwaysLoad"]: true`; declarations are capped
at 4 000 chars with the priority list (core-tools-and-hosts §6.2); results stay below 50 k chars
and error text below 11 k.

### 7.6 Open

> **Decided I-08 (2026-10-23):** Leave Claude Code subagents unchanged for now; the plugin ships no
> subagent definitions. Revisit if subagent built-in use skews harness results.
