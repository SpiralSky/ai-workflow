# 06 — circular import

## Prompt to give the AI
> The shop package is broken — `import shop` crashes with a circular `ImportError`. The package files are `models.py` and `services.py`. Fix the circular import.

## Notes for you (don't give to the AI)
- Bug: `models.py` imports `format_price` from `services.py`, and `services.py` imports `Product` from `models.py` — circular.
- Fix: move the `from services import format_price` import inside the `display()` method body in `models.py` (deferred/lazy import). Do NOT move `format_price` out of `services.py` — the hidden test imports it from there.
- Requires reading both files to diagnose, then touching 1 file (models.py only).
- Ideal: ~3–4 turns (read both, diagnose, move import inside method, verify tests).
