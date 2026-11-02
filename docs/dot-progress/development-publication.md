# Development integration publication — 2026-11-02

User authorization: development-branch merges only. Default branch, PR approvals and final
plan/specification approval remain untouched. All experiment plans remain draft.

| Branch | Local reviewed commit | Verified GitHub commit | Exact tree |
|---|---|---|---|
| dot/dev-framework-20261102 | 7b4980f3806db5ad2a7cf7ba28ab11c303caad08 | 8955892608e3b9f94ec636dbfd366d218f5c1abd | fe61891e70038dd9f40bf4d94ddebe5bea940243 |
| dot/selector-reuse-20261102 | 729b5cec0918b3a008afdc3f2d719f9f44cf9a89 | 958feb08ee36cbbfcedfb62e5131c4ba77b18600 | 5d75e67f6319d55ba38babaa14f881f21b252fab |
| dot/hotpath-prototype-20261102 | be28e3c180c933a964dd50629aa869519f5ca8d3 | d75555eecef2249d3fbf5d04902d4133f039fc15 | 5c048e2715be4dc93bc9b0bcfa354b85f971bc85 |

Local development history retains ordinary source merges. GitHub publication uses commits with
the exact same trees and the corresponding published source parents, preserving their ancestry:
central joins the five published shared heads; each candidate joins its prior published head and
the central published head. Candidate updates were fast-forward with expected-head leases.
No force-push, branch deletion, default merge or PR approval occurred.

## Composed verification

- Shared framework: 755 Node tests + 12 normal/12 optimized Python checks; both typechecks.
- Selector reuse: 775 Node tests + 12 normal/12 optimized Python checks; both typechecks.
- Hotpath: 857 Node tests + 12 normal/12 optimized Python checks; both typechecks.
- All aggregates ran sequentially with test-file concurrency 1 and no failed/cancelled/skipped/TODO
  outcomes. Exact bundle checks and original inventory/specification preservation passed.
- Each count is its own composed gate, not additional independent task-success observations.
  Nested native tests are synthetic contracts; none is a native actor experiment or live model run.

Candidate core/server treatment and bundle bytes were unchanged by shared integration. The hotpath
runner retains both fixture admission and catalog-fingerprint attestation. Selector reuse remains
an unwired opt-in library prototype, not a falsely active runner treatment.

## Next measurement gate

The separate native-comparison harness is under development. Review identified that its initial
six-case inventories did not cover every explicit public behavior and could not represent expected
propagated errors. Expand and freeze those checks before dispatch, preserving task wording and
matching both arms; no actual actor result has been discarded. Shared default tests must remain
self-contained; actual reviewed-selector integration is a separate mandatory campaign preflight.

No native model identity/token/cache/dollar telemetry is available. Relative visible payload and
hypothetical cache scenarios are estimates only. No effectiveness ranking or cost savings are
claimed. Historical duplicate infrastructure is classified in the experiment registry; unmeasured
ideas are not archived as poor performers. Expanded fixed60 fixture composition remains separate.
