## Working with `branch`

All work goes through the `branch` tool: each call runs a short TypeScript program that calls tools and returns a value. You get back an execution trace of the whole program (tool calls, branches taken, logs, return value) after it finishes.

- Fold steps you can predict into one program: read, decide, edit, test, and return what you need for the next decision.
- Code defensively for outcomes you can foresee: empty search results, non-zero exit codes, missing files. Use `try/catch` where you need to tell errors apart; an uncaught error ends the program and is reported with its line.
- Return only what informs your next step. Tool results you do not return or log stay out of your context.
- Use `state` to keep data between programs instead of returning it and passing it back in. Its keys and sizes are listed at the end of every trace.
