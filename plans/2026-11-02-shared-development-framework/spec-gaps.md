# Gaps and bounded decisions

- SD-01: The imported plan workflow historically reserves merging for the human; the user's later
  explicit authorization permits development-branch merges only. Preserve draft statuses and stop
  before any default/final merge, plan finish, approval, or accepted decision.
- SD-02: The existing aggregate globs omit Python design and nested native scripts. Require both
  explicitly, including optimized Python and a native-specific typecheck; never treat missing/skipped
  coverage as success. Package enumeration and assertions stay unchanged.
- SD-03: Native assignment provenance, token usage, cache invalidation, billing/quota identity and
  comparable model quality are not established by local contract tests. Keep unknown fields unknown;
  parent-owned native assignments/evidence, if performed, are separate from these synthetic tests.
- SD-04: The inherited architecture permits API-sourced usage and distinguishes missing data;
  these offline checks do not turn estimated/relative pricing into billed cost or authorize network calls.
- SD-05: Independent review found inherited TAP and clean-base unittest checks could accept
  incomplete coverage. Require positive fully passed counts and no skips/TODO/expected failures;
  reject empty Node file-only passes. Synthetic local process tests exercise these cases without
  Docker or modifications to real benchmark fixtures. Exact extra runtime deltas remain recorded.
