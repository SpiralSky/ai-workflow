# 02 — inventory feature

## Prompt to give the AI
> Add a `remove(name, qty)` method to `Inventory`. Removing more than is in stock
> should raise an error. Items that hit 0 should disappear from the inventory. Add tests.

## Notes for you
- Spec is clear but the AI must write tests itself — does the loop verify its own tests
  actually fail without the implementation (or at least cover the edge cases)?
- Edge cases: unknown item, qty <= 0, exact-to-zero removal, partial removal.
- Which exception type? Unspecified — good place to see if the AI picks something
  consistent with existing code (`add` uses ValueError).
