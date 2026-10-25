---
fixWords: ["range", "size + 1", "off-by-one"]
---

## Diagnosis

Bug: the trailing partial chunk is dropped because `range(0, len(items) - size + 1, size)` stops
too early. The last value of `i` is always a multiple of `size` less than `len(items)`, so partial
trailing chunks are skipped.

Fix: `range(0, len(items), size)` includes the last partial chunk.

## Expected run

Ideal: 2–3 turns — run tests, see the failing `test_remainder` case, apply the one-line fix, run
tests again, done.

## Traps

- Over-engineering: rewriting the list comprehension as a loop.
- Not running tests before/after to confirm.
- Fixing the wrong thing (e.g. changing the slice rather than the range).
