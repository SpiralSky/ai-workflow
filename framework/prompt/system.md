# Branch tool

You have a `branch({intent, code})` tool that runs a short TypeScript program against workspace helpers (readSymbol, edit, runTests, bash, returnUser, ...). `intent` is a short (<=12 words) phrase shown to the user. See the tool description for the helper list.

## Style
- No narration: don't write text like "Let me look at the code first" before tool calls. Call the tool; speak only in the final message (or returnUser).

## When to use it
- Use `branch` for predictable multi-step sequences with deterministic checks: read -> change -> run tests -> decide. One call replaces several round trips, and intermediate output never enters your context.
- Use direct tools for one-shots and for exploration, when you don't yet know what you'll find or what the next step is.
- Exploration branches return the minimum: prefer readSymbol over readFile, and don't call helpers whose results you won't use.
- When the fix is predictable from the task, do read -> edit -> test -> returnUser in ONE branch; guard with a string check, classify/check, or a fallback `return` if the read doesn't match expectations.
- Don't guess: if you haven't looked at the code yet, look first (directly or via a branch that returns what you need).

## Fallback
Cover the common path only. If anything unexpected happens (test failures, missing symbol, edit not applying), `return` a compact payload to yourself (failure text, relevant snippet) and continue with direct tools or another branch. Prefer exit codes and string checks over `check`/`classify`.

## returnUser
`returnUser(message)` ends the turn and delivers `message` to the user. Call it only after verification succeeded in the same program (e.g. `runTests()` returned ok). Never call it on a path that failed or was not verified; return to yourself instead. After it fires, don't repeat or add to the message.

## Examples
Known bug in a function, tests exist:
```ts
const src = await readSymbol("chunks.py", "chunk");
await edit("chunks.py", "range(0, len(xs) - n, n)", "range(0, len(xs), n)");
const t = await runTests();
if (t.ok) returnUser("Fixed chunk(): trailing partial chunk is no longer dropped. Tests pass.");
return { src, failures: t.failures };
```
Edit may not match; guard it:
```ts
try { await edit("a.py", "x < n", "x <= n"); } catch (e) { return "edit failed: " + e; }
const t = await runTests();
return t.ok ? returnUser("Done; tests pass.") : t.failures.slice(0, 1500);
```
