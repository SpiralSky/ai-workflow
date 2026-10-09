Task C — fix UX issues seen in an interactive run of bin/claude-branch (BRANCH_TOOLS="" mode) on problem 01.
Launch for testing: copy loop-testbed/problems/01-chunk-off-by-one/*.py to a fresh mktemp dir, run framework/bin/claude-branch there
(BRANCH_TOOLS="" forces branch-only). For non-interactive checks use `claude -p` with the same flags (see bin/claude-branch) and
--output-format stream-json --verbose --no-session-persistence --model haiku; parse, never dump raw streams.
For TUI checks use tmux if available (new-session -d, send-keys, capture-pane -p | tail), trust prompt needs "Yes".

Issues:
1. returnUser message is shown twice to the user (once in the tool result with the visible "<<RETURN_USER>>" marker, again as the
   hook's stopReason). Goal: the user sees the message once, cleanly, no marker text visible; the turn still ends without a further
   model call. Investigate options, verify empirically (log the hook's stdin to a file to see what tool_response contains):
   - PostToolUse `hookSpecificOutput.updatedMCPToolOutput` (replace tool output) — check Claude Code docs/behavior;
   - signalling via MCP result `_meta`/`structuredContent` instead of text marker, if visible to the hook;
   - empty/short stopReason vs systemMessage. Pick what renders best in the TUI. Keep the eval's returnUser detection working
     (eval/run.ts; can fall back to the branch trace file `type:"branch", kind:"user"` in BRANCH_TRACE_DIR).
2. The tool-call display shows the whole program. Add a required first input param `intent` (short phrase, <=12 words) before `code`
   so the TUI shows intent first; use it in the path summary/trace; drop the "start with a // comment" rule in prompts.
   If Claude Code supports a nicer display (e.g. MCP tool annotations.title), use it.
3. Wasted exploration: first branch called readFile + findFiles but used only the file. Prompt guidance (prompt/tool.md,
   prompt/system.md, keep them short): exploration branches return the minimum (prefer readSymbol over readFile; don't call helpers
   whose results you won't use; when the fix is predictable from the task, do read → edit → test → returnUser in ONE branch, using
   classify/check or a fallback return if the read doesn't match expectations).
4. Model narrates ("Let me look at the code first.") before tool calls: add a no-narration rule to system.md.
Update framework tests for the changes (npm test must pass, tsc clean). Final check: one -p run on problem 01 in branch-only mode
with sonnet: report turns, cost, path summaries, whether the turn ended via returnUser. Also describe how the final message looks in the TUI.
