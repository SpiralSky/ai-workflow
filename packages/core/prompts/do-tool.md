Hands one step of the work to an executor, which has the repository tools, and returns its report.

`instruction` is the step in natural language. The executor knows nothing beyond it, so include what it needs from earlier reports and cannot cheaply rediscover (a decided fix, an error message, the one relevant path), any limits ("only touch `pricing.py`"), and what to report back.

Pass large or exact content (code, test output, logs) as a reference instead of pasting it: `@s2` (an earlier step), `@s1.c3` (one tool call of a step), `@name` (a value an executor saved), `@src/pricing.py#apply_discount` (code, always current). Write `@@` for a literal `@`. Prefer a specific call or value to a whole report (`@s2`), which also passes on that report's guesses.

`tools` is optional: explicit tool names for the executor, replacing automatic selection. Omit it unless you know exactly which tools the step needs.

Several `do` calls in one turn run in parallel only when they only read; anything that can write runs alone.

The report ends with framework lines: `Changed:` (paths written), `Saved:` (values kept) and `Step: sN`.
