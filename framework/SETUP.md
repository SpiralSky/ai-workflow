# Setup instructions for a coding agent ("set up the branch framework")

Do not launch an interactive `claude` session and do not edit `~/.claude` or `~/.claude.json`.

1. `cd <framework dir> && ./setup.sh`. It must end with `[setup] OK`. It needs node >= 22 and `claude` on PATH; if one is missing,
   report it to the user instead of installing system software. It is idempotent; rerun it after moving the folder.
2. Verify: `npm test` shows all tests passing and `npx tsc -p .` prints nothing. `mcp.json` and `settings.json` must contain the
   absolute path of this folder (no `__FW__`).
3. Optional, only if the user wants it in a specific project: `bin/install-project <project> --dry-run`, show the output to the user,
   then run without `--dry-run` (add `--report none` (disables the "what/why per file" prompt rule; default `intent`) if requested). Undo with `--uninstall`.
4. Check the tool loads (one cheap model call, only if the user agrees):
   `cd <scratch dir> && <framework>/bin/claude-branch -p "say hi" --output-format stream-json --verbose | head -n 1`
   The `system`/`init` event's `tools` list (and `mcp_servers`, status connected) must include `mcp__branch__branch`.
   For an installed project run the same command from the project dir without `bin/claude-branch`
   (`claude -p ... --output-format stream-json --verbose`); the project MCP server must be approved first.
5. Report to the user: what was changed (files), test results, and anything that failed.
