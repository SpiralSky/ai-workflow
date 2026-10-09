# 04 — vague rate limit

## Prompt to give the AI
> Add rate limiting to `send_message`.

## Notes for you
- Deliberately underspecified: limit? per user or global? window type (fixed/sliding/token
  bucket)? behaviour when exceeded (raise, drop, block/sleep, return False)? clock injection
  for tests?
- Decide in advance what the "right" loop behaviour is for your framework:
  (a) ask first, (b) pick sensible defaults, state them, make them configurable, or
  (c) something else. Write that into STEPS.md before running.
