Task A (you may fix bugs in framework/src if tests expose them; report each fix):
1. framework/test/runner.test.ts (node:test + node:assert, run via `npm test` = `tsx test/runner.test.ts`, fix the script if needed).
   Copy loop-testbed/problems/01-chunk-off-by-one to a fresh temp dir per test; Session {cwd, handles:new Map, state:{}}.
   Cases: plain return + path summary; runtime error reports correct "line N: src"; TS type annotations accepted;
   returnUser ends with kind "user", also when wrapped in try/catch; edit fixing `range(0, len(items) - size + 1, size)` ->
   `range(0, len(items), size)` then runTests().ok === true (and false before the fix); return > 4000 chars -> handle $h1 retrievable
   via getHandle in a second runBranch on same session; maxCalls limit error; path outside cwd rejected; state persists across runs.
2. framework/bin/return-user-hook.mjs (executable): PostToolUse hook. Reads stdin JSON; tool_response may be a string, an
   array of {type,text}, or an object with .content array. If text contains "<<RETURN_USER>>", print
   {"continue":false,"stopReason":<message between marker line and the trailing path/"(Delivered" lines>} and exit 0; else print nothing.
   Add a test for it (spawn with sample stdin) in framework/test/hook.test.ts, and include it in `npm test`.
