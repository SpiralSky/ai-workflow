# 08 — API contract mismatch

## Prompt to give the AI
> `client.py` crashes with a `TypeError` when calling the server functions. Fix it.

## Notes for you (don't give to the AI)
- `compute_stats` takes `include_variance=True` but client passes `variance=True`.
- `normalize` takes `method="zscore"` but client passes `norm="zscore"`.
- Fix is in `client.py` only — two one-word kwarg corrections.
- Requires reading both files to find the right kwarg names (can't fix without reading server.py).
- Ideal: ~3–5 turns (read client, read server, fix client, run tests).
- Watch for: model fixing server.py instead of client.py (wrong side); missing one of the two bugs.
