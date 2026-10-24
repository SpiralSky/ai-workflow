Returns the content of a reference (`@s1.c2`, `@name`, `@src/a.py#Symbol`) or a stored live-ref object, capped at about 1k tokens with a truncation note.

Use it to look up an exact value from a report or a saved value (for example the names in `@failingTests`). Do not use it to read code: reading belongs in a `do`.

`grep` (a regex) returns only the matching lines with line numbers; `lines: [from, to]` returns that 1-based inclusive range.
