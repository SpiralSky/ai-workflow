# Orchestrate hot-path wiring and native bridge design

Date: 2026-11-03. Status: no-model wiring verified; native completion bridge is reviewed design only. No idea is promoted and no quality, token, cost or speed improvement is established.

## Exact scope

The candidate is the actual orchestrate hot-path implementation at commit `8dcf05bad0c0f7c806db3d7350060435018773f8`, full upstream tree `cb1c1564f02f493bd9bb7cb10b7e9180a136d4a6`. The tested artifact is a sanitized 111-file source/config/public-test subset, not an unchanged full checkout. Its manifest records original blob IDs, SHA-256 hashes, modes and 511 excluded paths. All experiments and Git history were excluded. Manifest SHA-256: `fe6d305886d9eb040b5ace23d565fba7ff34cf2a22b2d369ae8cb48322bd62c1`.

The copied installed dependency closure contains 9,801 entries, including 23 symlinks whose resolved targets stay inside the export. Its exact bytes/modes were checked before and after the tests. This is a fingerprinted existing runtime, not a fresh lockfile-integrity installation. No dependency installation or real provider request occurred.

## Verified no-model controls

An independent review reproduced all 120 selected public tests and four scripted probe arms:

- Automatic selection, hot paths off/on: one synthetic selection completion, two synthetic executor completions and one synthetic host call per arm. Only the enabled arm attached the expected hot-path snippets.
- Explicit tool override, off/on: no selection completion and no hot-path snippets; two synthetic executor completions and one synthetic host call per arm.
- All arms exercise real `buildFramework("orchestrate")`, selection/executor logic, QuickJS branch execution, host binding, reports and reference resolution. The completion client and Host are scripted, not model actors or the full native LocalHost/sidecar fixture.
- Synthetic usage zero is fixture data only. Actual native token, cache and billing usage is unknown.

A supplementary cross-run exact-request comparison failed because a real trace duration changed from 3 ms to 4 ms. The raw difference and failed assertion were preserved. The revised probe asserts semantic controls while retaining every raw request difference, without normalization or a claim of deterministic prompt equality. Its author run also observed an explicit-override trace of 2 ms versus 1 ms; its independent rerun observed equality. Both are valid observations.

Revised probe SHA-256: `f89c7a496ef38c4179528c873300a4c6888a618d82bb7b7f00be3cd278d7b577`.
Independent review report SHA-256: `a9d49f3c7ed4708ac04c87938e0a19dd220c53f46088305e703131f84b1cfb55`.
Independent evidence index SHA-256: `699b61bf87909ae43c3cd817cd6afad4c7016b31e649ce1bd559677efd5bab4e`.

## Smallest faithful native bridge, not implemented

The reviewed proposal retains the real orchestrate engine and connects its existing host client/broker with linked in-memory transports to a bounded native completion adapter. It does not replace executor actions with direct planner calls. It requires a new pinned combined source identity incorporating the later safe-persistence harness; both comparison arms must use that same identity and differ only by the recorded hot-path flag.

Mandatory implementation gates include:

1. A separate bounded completion channel while the planner action remains pending, fixed-command raw-stdin capture, strict request/response binding, durable receipts, prompt cancellation and replay/deadline/byte-limit controls.
2. Sticky fatal state in session and supervisor. An engine error catch must not allow submit or a successful snapshot after a bridge fault.
3. A bounded durable engine-event sink, retaining actual roles and completion provenance instead of the current native session's no-op sink.
4. Explicit unavailable usage (`null`), never invented numeric zero. Distinct versioned native artifacts must be rejected by existing numeric reporting/budget consumers until supported. Unsupported model, temperature and token-limit controls must fail before lossy host-client projection.
5. Checked current-workspace reference reads, including legitimate edited/new allowed files, with containment, no-symlink, permitted-delta and byte limits.
6. Expanded sanitized source/runtime closure, deterministic real-broker round trips, negative controls, independent patch review and an external checkpoint before any native pilot.

Reviewed design SHA-256: `bcb37c6a75956b8407df909fb12a1393778d59b0527738c80d3e5325d227af62`. Its earlier versions and review corrections are preserved. Design review is not bridge validation.

## Admission remains blocked

The new candidate checkout was recoverably removed after its public remote identity was verified. Its sanitized export does not remove older benchmark copies. A separate metadata-only recovery assessment found 18 legacy hidden/reference paths in five older checkouts. Their Git histories and runtime dependencies are shared, and some local branch tips lack verified external recovery. They are preserved; no broad deletion or history rewrite was attempted. The earlier calendar-specific absence check did not cover these legacy paths. There is no evidence that the earlier calendar actors read them, but whole-environment absence cannot be claimed.

No new actors may run until known reference/history handling is resolved and the bridge is implemented, independently validated and frozen. Native tool-log coverage, subprocess reads, exact model identity, API-level prompt roles and actual consumption remain unverified. A future matched run would be limited cooperative screening, not proof that an idea beats baseline or evidence of hostile-code isolation. The earlier direct calendar pair remains harness evidence, not an orchestrate comparison.
