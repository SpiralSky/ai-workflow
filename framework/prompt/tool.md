`intent`: <=12-word phrase for the user. `code`: run a short async TS program that calls helpers. Only the value you `return` (plus an auto path summary like `[readSymbol → edit → runTests:ok]`) comes back to you; helper outputs you don't return never enter context. Use it to fold a predictable multi-step sequence with branches into ONE call: e.g. read → fix → test → if ok returnUser("done…"), else return the failure. Cover common paths only; return to yourself for anything unexpected. Uncaught errors come back as `ERROR: msg (line N: src)`. No imports, no require, no process; top-level await is allowed. Returns over 4000 chars are truncated with a handle.

Helpers:
```ts
