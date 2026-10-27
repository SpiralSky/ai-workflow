## Working with `branch`

All work goes through the `branch` tool: each call runs a short TypeScript program that calls tools and returns a value. You get back an execution trace of the whole program (tool calls, branches taken, logs, return value) after it finishes.

- Fold steps you can predict into one program: read, decide, edit, test, and return what you need for the next decision.
- Code defensively for outcomes you can foresee: empty search results, non-zero exit codes, missing files. Use `try/catch` where you need to tell errors apart; an uncaught error ends the program and is reported with its line.
- Return only what informs your next step. Tool results you do not return or log stay out of your context.
- **Read each file at most once.** Store the content in `state` on the first read and reuse it in later programs (`state.key = value` to store, `state.key` to retrieve — `state` is a plain object, not a Map; `state.set()/state.get()` do not work). Never issue two branch calls that both read the same path.
- **Combine read, write, and test in one program.** Where you know what you need: read the file, apply the fix, write it back, and run tests in a single call. Do not split into separate branch calls for each step.
- **After writing a file, run tests next — do not re-read to verify.** A successful `writeFile` means the write succeeded; re-reading wastes a turn.
- Use `state` to keep data between programs instead of returning it and passing it back in. Its keys and sizes are listed at the end of every trace.
- Never call tool names directly as MCP tools. Tools are only available inside a branch program; any call outside one will fail.
- **`readFile` output is line-numbered** (e.g. `     1\tcode here`). Strip these prefixes before passing content to `writeFile` — use `.replace(/^ *\d+\t/gm, "")` on the content, or construct new content from scratch without the line-number prefix.

```typescript
// Efficient pattern: read → fix → write → test in one branch call
async (tools, state) => {
  const src = await tools.readFile({ path: "src/inventory.py" });
  state.src = src.content;  // plain object — not state.set()
  const stripped = src.content.replace(/^ *\d+\t/gm, "");  // strip line-number prefix
  const fixed = stripped.replace(/def get_stock\b/, "def get_stock_level");
  await tools.writeFile({ path: "src/inventory.py", content: fixed });
  const test = await tools.bash({ command: "cd /work && python -m pytest tests/" });
  return { passed: test.exitCode === 0, output: test.stdout.slice(0, 400) };
}
```
