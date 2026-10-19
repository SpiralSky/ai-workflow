Task E — toggleable/attach mode: make the framework usable as an on-demand command without permanent installation.

## Goal
The framework is currently "installed" into a project by `bin/install-project` (writes to `.mcp.json`, `.claude/settings.json`,
`CLAUDE.md`). This makes it always active and requires re-running install after changes. The goal: provide an on-demand
"attach" mode where running one command starts Claude with the framework attached, without modifying any config files.

## Changes

### 1. `bin/claude-branch` — add `--attach` flag
Current default: `--setting-sources "" --strict-mcp-config` (fully isolated, strips user and project settings).
New `--attach` flag: keeps user and project settings, adds the framework MCP and settings on top.
The `--attach` flag is mutually exclusive with `--bare` (bare implies isolated; document this clearly).

When `--attach` is set:
- Drop `--setting-sources ""` (keeps user + project settings)
- Drop `--strict-mcp-config` (project/user MCP servers remain, framework MCP is added via `--mcp-config`)
- Keep `--settings "$D/settings.json"` (adds framework env/permissions/hooks on top via merge)
- Keep `--mcp-config "$D/mcp.json"` (additive without --strict-mcp-config)
- Keep `--append-system-prompt-file` (additive)
- Keep `ENABLE_TOOL_SEARCH=false` export and `gen-config`

Update the comment block at the top of `bin/claude-branch` to document both modes clearly.

### 2. `bin/install-project.mjs` — add `--script` flag
When `--script` is passed: instead of writing to `.mcp.json`, `.claude/settings.json`, and `CLAUDE.md`,
generate a local executable script `<dir>/claude-branch` (or `<dir>/branch` if a `claude-branch` already exists)
containing exactly:
```
#!/usr/bin/env bash
exec "/abs/path/to/framework/bin/claude-branch" --attach "$@"
```
Make it executable (`chmod +x`). Print what was written.
Uninstall (`--script --uninstall`): remove that generated script if it matches the pattern above.
`--script` is incompatible with `--dry-run --uninstall` at the same time; error if both passed.
Keep all existing non-`--script` behavior unchanged.

### 3. `framework/README.md` — update Quick start and Install sections
Add a new section **On-demand (recommended for active development)**:
```
# Attach to your current project without any installation:
/path/to/framework/bin/claude-branch --attach
# Or generate a local script so you can just run ./claude-branch:
bin/install-project <dir> --script
./claude-branch
```
Note that the attach mode keeps all your existing project settings and MCP servers — it just adds the branch tool
and its system prompt on top. When you are done, close Claude; nothing was changed in your project config.
Contrast with the existing "Install into an existing project" section (permanent, always-on).

## Acceptance checks
- `cd framework && npm test && npx tsc -p .` still pass after changes.
- `bin/claude-branch --help 2>&1 || bin/claude-branch --unknown 2>&1 | head -5` shows the updated usage.
  (Or just run `bash -n framework/bin/claude-branch` to check for syntax errors.)
- `bin/install-project /tmp/test-attach-$$ --script` creates `/tmp/test-attach-$$/claude-branch`, is executable,
  contains the exec line. Cleanup: `rm -rf /tmp/test-attach-$$`.
- `bin/install-project /tmp/test-attach2-$$ --script --uninstall` with the script present removes it cleanly. Cleanup.

## Files allowed to change
- `framework/bin/claude-branch`
- `framework/bin/install-project.mjs`
- `framework/README.md`
