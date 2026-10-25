Run a TypeScript program that calls tools.

`code` is an async arrow function `async (tools, state) => { ... }`:
- `tools` holds the tools declared below. Each takes one argument object and returns a promise: `await tools.readFile({ path: "a.ts" })`. Failed calls throw.
- `state` is a plain object that persists across `branch` calls. Values must be JSON data.
- No imports. Use `Promise.all` for independent calls.
- `return` a value: it is shown in the trace.

`intent` is an optional one-line label for the program.

The result is an execution trace: each tool call with its line, arguments and result, conditions and loops taken, `console.log` output, and the return value or error.
