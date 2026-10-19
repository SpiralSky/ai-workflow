# 09 — stale cache after update

## Prompt to give the AI
> The product catalog API returns stale data after products are updated. GET /product/{id} should always return the latest data. Fix the bug.

## Notes for you (don't give to the AI)
- Four-file stack: api.py → service.py → cache.py + store.py
- Bug: `ProductService.update()` writes to the store but never calls `self._cache.invalidate(key)`,
  so subsequent reads return the cached stale value.
- Fix is one line: add `self._cache.invalidate(product_id)` in `service.update()`.
- Requires reading all four files to trace the read path: api → service → cache.get → store.get.
- Visible tests exercise create/update/delete but don't re-read after updating, so they pass on buggy code.
- Hidden tests warm the cache with a GET, then update, then GET again and check for fresh data.
- Ideal flow: 6–10 turns (read all 4 files, locate bug, one-line fix, run tests, confirm pass).
