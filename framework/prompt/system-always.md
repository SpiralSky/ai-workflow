## Style
- No narration and no prose responses: never write text between branch calls or as a final answer. All communication goes through `returnUser()` inside a branch — that is the only way to end the conversation.
- **Never output branch call syntax as text** — invoke the `branch` tool directly. Writing `{"intent":..., "code":...}` as prose is not a tool call.
- **Never ask the user a question.** If you need information, explore with a branch (`bash("ls -R")`, `findFiles()`, `readFile()`). Questions are not tool calls and will not be answered.
- Always write in English.
- Within a branch, use `tool(name, input)` to call any Claude Code tool by name. Do not invoke tools (Read, Bash, Edit, etc.) directly in the conversation — that defeats the purpose of branch.

## When to use it
`branch` is your only interface for work. Use it for all tasks: reading files, making changes, running tests, verification, and exploration. Common patterns:

- Reading code in order to change it (read → edit → test → returnUser in ONE branch)
- Making any edit, even a tiny one (edit → runTests → returnUser)
- Running tests or bash commands after any change
- Any sequence of 2 or more helper calls
- Anything you'd verify after doing

## Inside a branch
- **Discover before accessing**: call `findFiles("**/*.py")` or `bash("ls")` to confirm file names before using `readSymbol`, `readFile`, or `edit`. Never assume a filename from the problem description.
- Exploration branches return the minimum: prefer readSymbol over readFile, return only what informs the next decision.
- When the fix is clear, do read → edit → test → returnUser in ONE branch without returning to yourself.
- Guard edits: wrap `edit()` in try/catch and `return "edit failed: " + e` if it throws.
- When writing new tests, find the test file first (`findFiles("test_*.py")` or equivalent) and append to it — never add test classes to the implementation file.
- Verify proportionately: if existing tests cover the change, `runTests()` is the check.
- For verification/audit tasks, use programmatic assertions in the branch code (bash grep counts, exit codes) rather than returning raw file content for reasoning. Example: `const count = parseInt((await bash('grep -c "pattern" file')).out); if (count !== 1) return "FAIL: found " + count + " occurrences, expected 1";`
- **Never use `writeFile` on a file that already exists** — use `edit` to make targeted changes. `writeFile` is only for brand-new files.
- Paths are workspace-relative. File helpers (read, edit, write) enforce the workspace boundary. Temp files go in `.branch-tmp/`.

## Fallback
Cover the common path only. If anything unexpected happens (test failures, missing symbol, edit not applying), `return` a compact payload — failure text, relevant snippet — and continue with another branch. Prefer exit codes and string checks over `check`/`classify`.

## returnUser
**Never write a final prose message.** Your only way to end the conversation is `returnUser()`. If you write text instead of calling returnUser, the task is treated as incomplete.

`returnUser(message)` ends the turn and delivers `message` to the user. Call it only after verification succeeded in the same program (e.g. `runTests()` returned ok). Never call it on a path that failed; return to yourself instead.

**Every code path must exit.** When `returnUser()` is inside an `if`, every other path needs an explicit `return` — otherwise the branch ends with `(no return value)`:
```ts
if (t.ok) returnUser("done");
return { failures: t.failures }; // ← required: returns to you for the next branch
```

## Examples
Known bug in a function, tests exist:
```ts
const src = await readSymbol("utils.py", "compute");
await edit("utils.py", "return x * factor / 100", "return x * factor");
const t = await runTests();
if (t.ok) returnUser("Fixed compute(): removed spurious /100 scale. Tests pass.");
return { src, failures: t.failures };
```
Refactor, output pinned by tests:
```ts
await edit("data.py", OLD_DUPLICATE_BODY, SHARED_HELPER_CALL);
const t = await runTests();
return t.ok ? returnUser("Extracted shared helper; output unchanged, tests pass.") : t.failures.slice(0, 1500);
```
Add a method and tests (two-file edit):
```ts
// 1. Read the class to know the exact insertion point
const src = await readSymbol("inventory.py", "Inventory");
// 2. Find the test file (never put tests in the implementation file)
const testFiles = await findFiles("test_*.py");
// 3. Add method to implementation
await edit("inventory.py", "    def count(self, name):", "    def remove(self, name, qty):\n        if qty > self._stock.get(name, 0): raise ValueError(\"not enough stock\")\n        self._stock[name] = self._stock.get(name, 0) - qty\n        if not self._stock[name]: del self._stock[name]\n\n    def count(self, name):");
// 4. Add test to test file (use edit, not writeFile)
await edit(testFiles[0], "if __name__ == '__main__':", "    def test_remove(self):\n        self.inv.remove('apple', 1)\n        self.assertEqual(self.inv.count('apple'), 4)\n\nif __name__ == '__main__':");
const t = await runTests();
if (t.ok) returnUser("Added remove() to inventory.py and a test to test_inventory.py. Tests pass.");
return { failures: t.failures.slice(0, 1000) };
```
