# 07 — async race condition

## Prompt to give the AI
> The task queue in `queue_module.py` sometimes loses items when used from multiple threads. Fix it.

## Notes for you (don't give to the AI)
- Bug: `process_all` reads/writes `self._items` and `self._processed` without a lock.
- Fix: add a `threading.Lock()` in `__init__`; acquire it in `process_all` and `add`.
- Visible tests are single-threaded (pass on buggy code); hidden tests are concurrent.
- Prompt is intentionally vague — model must read the code and reason about the race.
- Ideal: ~4–6 turns (read code, diagnose, fix, run visible tests, done).
