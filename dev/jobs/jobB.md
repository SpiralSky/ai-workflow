Task B (do NOT edit framework/src, framework/test, or framework/package.json other than adding an "eval" script):
Verified facts: hooks in a file passed via `claude --settings <file>` DO fire; PostToolUse hook printing {"continue":false,"stopReason":msg}
ends the turn (stopReason is not in -p output). Separation from the user's normal config is done with
`--setting-sources "" --settings framework/settings.json --strict-mcp-config --mcp-config framework/mcp.json`.
1. framework/mcp.json: server "branch", command node with tsx loader (`node --import tsx <abs>/framework/src/server.ts`, resolve tsx from
   framework/node_modules; verify it starts: e.g. send an MCP initialize + tools/list over stdin and check the tool is listed).
   Server env: BRANCH_CWD is not needed (server uses process.cwd(), which is claude's cwd) — verify that's true for stdio servers.
2. framework/settings.json: PostToolUse hook matcher "mcp__branch__branch" -> framework/bin/return-user-hook.mjs (absolute path;
   another job is writing that script), permissions allow mcp__branch__branch.
3. framework/prompt/system.md (short, <60 lines): when to use branch vs direct tools (branch for predictable multi-step sequences
   with deterministic checks; direct tools for one-shots/exploration); fallback = return a compact payload to yourself; use
   returnUser only after verification succeeded; 1-2 short examples (01-style: readSymbol -> edit -> runTests -> returnUser, else return failures).
4. framework/bin/claude-branch (bash, executable): runs claude with the separation flags above + --append-system-prompt-file system.md,
   BRANCH_TRACE_DIR default ./.branch-traces, passes "$@" through.
5. eval/run.ts (run via tsx from framework: `npm run eval -- --problem 01 --mode baseline|branch|both --n 3 --model sonnet`):
   per run: copy loop-testbed/problems/<id>* to a temp dir, prompt = PROBLEM.md contents, run
   `claude -p <prompt> --output-format stream-json --verbose --no-session-persistence --model M --permission-mode bypassPermissions`
   with --setting-sources "" --strict-mcp-config; baseline: no MCP; branch: + --mcp-config/--settings/--append-system-prompt-file
   and BRANCH_TRACE_DIR=<runs dir>. Save raw stream to eval/runs/<ts>/<problem>-<mode>-<i>.jsonl. Afterwards run the problem's tests
   (look at loop-testbed to see how tests/success are defined). From the final "result" event take num_turns, total_cost_usd, usage
   (input, output, cache_read, cache_creation), duration_ms; count branch tool calls and whether returnUser fired (tool result contains
   "<<RETURN_USER>>"). Print one compact table row per run + per-mode means. Stdout must stay small (no raw streams).
   Don't actually run the eval with a model (costly); just test the parsing on a tiny fixture and `--help`.
