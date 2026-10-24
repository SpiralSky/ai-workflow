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
           [--mcp-config <path>…] [--read-only] [--allow-server <name>…] [--deny-server <name>…]
           [--max-chars N] [--priority <tool>,…]
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

Output caps (harness-integration §5.4) are applied by the framework (trace limits, report cap, tool caps) before the
result is returned.

---

## 3. Hosts

| Host | Implementation |
|------|----------------|
| `LocalHost` | Wraps `@aiw/tools` catalog for a tier, contained to the root. Used by the runner host and as the built-in source for MCP fallback. |
| `McpClientHost` | Connects as an MCP client to one server (stdio or HTTP) from a config entry; lists and calls its tools. Used for discovered user servers and `claude mcp serve`. |
| `CompositeHost` (core) | Merges hosts, first wins on name conflict, conflicts reported. |
| `CheckedHost` (core) | Applies a `Checker` before each call ([core-tools-and-hosts §5](core-tools-and-hosts.md#5-wrapper-stack)). |
| `ChannelHost` | Native host over the call channel (harness-integration §4.5): JSON lines `{ id, parent, name, args }` / `{ id, ok, value \| error, durationMs }` / `{ cancel: id }` / `{ pause: id }` / `{ resume: id }` (approval waits, §4.6) over a socket path or fd given by the plugin. Built when a native-capable harness is confirmed (harness §12 Q1). |

---

## 4. Host compositions

| `--host` | Composition |
|----------|-------------|
| `local` (runner) | `LocalHost(tier)` — no checks; reporter only |
| `fallback` | `CheckedHost(PolicyChecker, Composite(LocalHost(S or configured tier), McpClientHost × discovered))` |
| `mirrored` | `CheckedHost(AdapterChecker(adapter), Composite(McpClientHost(harness tool server) or LocalHost(S), McpClientHost × discovered))` |
| `native` | `ChannelHost` (the harness applies its own checks) |

**Config discovery** reads the MCP config locations a plugin names (`--mcp-config <path>`
repeatable) and starts each server as a second instance. HTTP/remote servers are excluded by default
(I-09) and stay direct, not routed (harness §4.2, §6.1).

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

- **PolicyChecker** (fallback, harness-integration §7.3): policy file (JSON) with `root` containment, per-tool
  allow/deny/ask, `bash` command patterns, and a built-in deny list of destructive patterns
  (`rm -rf /`, `git push --force`, writes outside root, `curl … | sh`, …). No matching rule →
  harness-integration §7.3 default (read inside root: allow; `write`/`exec`: ask; else deny).
- **Read-only mode** (harness-integration §7.4): `--read-only` or session context `plan` → any call with
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
  hooks/hooks.json             { "modules": ["./register.ts"] }
  hooks/register.ts            hooks module: prompt.compose, tool.call, tool.describe
  prompts/branch-only.md, prompts/orchestrate.md   framework prompt sections
  server/aiw-server.mjs        bundled server (same build as the job container)
  server/node_modules/isolated-vm   optional fast engine with its prebuilt binaries (~13 MB)
```

`isolated-vm` is external to the esbuild bundle and shipped beside it with its prebuilds
(linux-x64/arm64 glibc+musl, darwin-arm64, win32-x64; Node 22 and 24). `mcpServers.aiw` launches
`node --no-node-snapshot server/aiw-server.mjs --engine auto` (core-branch §4.1). Where the fast
engine cannot load (e.g. Intel macOS, another Node version), the server falls back to QuickJS and
the hooks module shows its `note` once, at the first session start (plugins have no install hook),
saying how to get the faster engine.

The prompt files are copied at build time from `@aiw/core/prompts/<framework id>.md` so they are
byte-identical to what was measured (harness-integration §2). `prompt.compose` appends the one
chosen by `userConfig.framework` as a session-scoped system-prompt section.

### 7.2 Routing (B2)

- The server writes the routed set at startup to `${CLAUDE_PLUGIN_DATA}/routed.json`: the fixed
  built-in names (`Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep`, …, from the name table in §7.3)
  plus `mcp__<server>__*` for each discovered server it reaches.
- `tool.call`: a call whose name matches the routed set is denied with "call `<inner name>` from a
  `branch` program"; anything else runs unchanged.
- `tool.describe`: routed tools get `isDeferred: true`.
- Unit tests: a fixture of tool names × routed set → decision.

### 7.3 Tool source (B3)

`McpClientHost` over `claude mcp serve` (spawned by the server), mapped by the name table
(`bash ↔ Bash`, `readFile ↔ Read`, …). If `claude mcp serve` is unavailable, `LocalHost(S)`.
User servers from Claude Code MCP config locations (user/local, project `.mcp.json`, enabled
plugins, managed).

### 7.4 Session context

> **Decided A-22 (2026-10-23, approved; updated 2026-10-24 for the hooks module):** The plugin's
> `tool.call` hook on the framework tools rewrites the input, adding `__session: { permission_mode, session_id, transcript_path, cwd }` to the
> tool input. The server strips `__session` before the call and uses it for the checks (B4 steps 3–4
> inputs). This is race-free (context travels with the call) and needs no side channel.
> To verify at build time: the tool schema must allow the extra property
> (`additionalProperties: true`, not described to the model).
> *Fallback if that check fails:* the hook writes context to a file keyed by session id under
> `${CLAUDE_PLUGIN_DATA}`, read by the server — needs the server to learn its session id.

### 7.5 `ClaudeCodeChecker` (B4)

Ordered steps exactly as B4: name mapping → `PreToolUse` hooks (spawned with Claude Code's hook
input JSON; `permissionDecision`, `updatedInput`, exit code 2) → permission rules on the final
(hook-updated) input (managed/user/project/local settings, deny > ask > allow, Claude Code pattern
syntax) → permission mode → ask via elicitation. A hook `allow` skips the ask but not deny rules;
first deny wins. `PostToolUse` hooks in `after`. A table-driven test suite (rules, modes, hooks, calls →
decision) is pinned to the Claude Code version in `plugin.json` (B4 "Drift").

Limits (B5): the `branch` tool sets `_meta["anthropic/alwaysLoad"]: true`; declarations are capped
at 4 000 chars with the priority list (core-tools-and-hosts §6.2); results stay below 50 k chars
and error text below 11 k.

### 7.6 Subagents

> **Decided I-08 (2026-10-23):** Leave Claude Code subagents unchanged for now; the plugin ships no
> subagent definitions. Revisit if subagent built-in use skews harness results.
