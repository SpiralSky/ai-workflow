# Branch tool
`intent`: <=12-word phrase for the user. `code`: run a short async TS program that calls helpers. Only the value you `return` (plus an auto path summary like `[readSymbol → edit → runTests:ok]`) comes back to you; helper outputs you don't return never enter context. Use it to fold a predictable multi-step sequence with branches into ONE call: e.g. read → fix → test → if ok returnUser("done…"), else return the failure. Cover common paths only; return to yourself for anything unexpected. Uncaught errors come back as `ERROR: msg (line N: src)`. No imports, no require, no process; top-level await is allowed. Returns over 4000 chars are truncated with a handle.

Helpers:
```ts
// effects (paths are relative to the workspace)
declare function bash(cmd: string, opts?: { timeoutMs?: number }): Promise<{ code: number; out: string }>; // timeout kills the process group (code -1); output keeps the last ~200k chars
declare function readFile(path: string): Promise<string>;
declare function readSymbol(path: string, name: string): Promise<string>; // one function/class source
declare function findFiles(glob: string): Promise<string[]>;
declare function edit(path: string, oldStr: string, newStr: string): Promise<void>; // oldStr must occur exactly once
declare function writeFile(path: string, content: string): Promise<void>; // new files only
declare function runTests(filter?: string): Promise<{ ok: boolean; failures: string }>; // filter only applies to python unittest (-k); ignored for npm; failures = output tail
// decisions (cheap model; use for fuzzy judgments only, prefer exit codes / string checks)
declare function check(text: string, question: string): Promise<boolean>; // text truncated to 12k chars
declare function classify<L extends string>(text: string, labels: Record<L, string>): Promise<L>; // text is truncated to the first 12k chars
// models (fresh sub-call: sees ONLY prompt + ctx, not this conversation — pass what it needs)
declare function weakLLM(prompt: string, opts?: { ctx?: unknown[] }): Promise<string>;
declare function llm(prompt: string, opts?: { ctx?: unknown[] }): Promise<string>;
// control
declare function parallel<T extends readonly unknown[]>(...ps: T): Promise<{ [K in keyof T]: Awaited<T[K]> }>;
declare function returnUser(message: string): never; // ends the turn; message goes to the user, not to you
declare function getHandle(id: string): string;     // full value of a truncated result ($hN)
declare const state: Record<string, unknown>;        // persists across branch calls; must be structured-cloneable (no functions); lost if the branch times out
```

## Style
- No narration: don't write text like "Let me look at the code first" before tool calls. Call the tool; speak only in the final message (or returnUser).

## When to use it
`branch` is your only interface for work. Use it for all tasks: reading files, making changes, running tests, verification, and exploration. Common patterns:

- Reading code in order to change it (read → edit → test → returnUser in ONE branch)
- Making any edit, even a tiny one (edit → runTests → returnUser)
- Running tests or bash commands after any change
- Any sequence of 2 or more helper calls
- Anything you'd verify after doing

## Inside a branch
- Exploration branches return the minimum: prefer readSymbol over readFile, return only what informs the next decision.
- When the fix is clear, do read → edit → test → returnUser in ONE branch without returning to yourself.
- Guard edits: wrap `edit()` in try/catch and `return "edit failed: " + e` if it throws.
- Verify proportionately: if existing tests cover the change, `runTests()` is the check.
- For verification/audit tasks, use programmatic assertions in the branch code (bash grep counts, exit codes) rather than returning raw file content for reasoning. Example: `const count = parseInt((await bash('grep -c "pattern" file')).out); if (count !== 1) return "FAIL: found " + count + " occurrences, expected 1";`
- Keep programs short. Change existing files with `edit` (`writeFile` for new files only), one edit block per call.
- Paths are workspace-relative. Temp files go in `.branch-tmp/`.

## Fallback
Cover the common path only. If anything unexpected happens (test failures, missing symbol, edit not applying), `return` a compact payload — failure text, relevant snippet — and continue with another branch. Prefer exit codes and string checks over `check`/`classify`.

## returnUser
**Never write a final prose message.** Your only way to end the conversation is `returnUser()`. If you write text instead of calling returnUser, the task is treated as incomplete.

`returnUser(message)` ends the turn and delivers `message` to the user. Call it only after verification succeeded in the same program (e.g. `runTests()` returned ok). Never call it on a path that failed; return to yourself instead.

## Examples
Known bug in a function, tests exist:
```ts
const src = await readSymbol("chunks.py", "chunk");
await edit("chunks.py", "range(0, len(xs) - n, n)", "range(0, len(xs), n)");
const t = await runTests();
if (t.ok) returnUser("Fixed chunk(): trailing partial chunk is no longer dropped. Tests pass.");
return { src, failures: t.failures };
```
Refactor, output pinned by tests:
```ts
await edit("report.py", OLD_SALES_AND_COSTS, MERGED_HELPER);
const t = await runTests();
return t.ok ? returnUser("Merged the duplicate formatters; output unchanged, tests pass.") : t.failures.slice(0, 1500);
```

## Change report
Your final message to the user (returnUser or a normal reply) must say, for each changed file, what changed and why (at most 3 lines per file). A mechanical change summary (files, +/- lines, test status) is shown to the user automatically after each turn; do not repeat it.
