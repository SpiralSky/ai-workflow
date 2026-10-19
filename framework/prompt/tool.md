Never write prose before a `branch` call — start immediately with a `branch` call.

`intent`: <=12-word phrase for the user. `code`: run a short async TS program that calls helpers. Only the value you `return` (plus an auto path summary like `[readSymbol → edit → runTests:ok]`) comes back to you; helper outputs you don't return never enter context. **Every program must end with an explicit `return` statement** — if you don't, all results are lost and you get `(no return value)`. Use it to fold a predictable multi-step sequence with branches into ONE call: e.g. read → fix → test → if ok returnUser("done…"), else return the failure. Cover common paths only; return to yourself for anything unexpected. Uncaught errors come back as `ERROR: msg (line N: src)`. Full Node.js is available (require, dynamic import via `await import()`, process). Top-level await is allowed. Static top-level `import` statements are not supported (use dynamic import instead). Returns over 4000 chars are truncated with a handle.

Use `tool(name, input)` to call any Claude Code built-in tool by name (e.g. `tool("Read", {file_path: "..."})`, `tool("WebFetch", {url: "..."})`). Do not call tools directly outside a branch — that defeats the context-hygiene purpose of branch.

Helpers:
```ts
