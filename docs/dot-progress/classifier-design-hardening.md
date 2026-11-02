# Offline comparison-design contract hardening — 2026-11-02

**Draft experiment; no approval, campaign readiness, live calls, costs, quality or savings measured.**

Base: PR4 head `67b42ae04153079e84b1fdacdd0082a2e623ffc8`; isolated branch
`dot/design-contract-hardening-20261102`. Plan: `2026-11-02-classifier-design-hardening`.

## Change and rationale

The old checker used assertions and accepted omitted cells/wrong requested models under `python -O`.
It also left models, selector policy/completion, fixed-across-arms declarations and provenance unchecked.
The checker now uses explicit exceptions and an independent literal frozen contract, strict types/keys,
exact unique 60-cell coverage, exact five arm identities/model settings, strict bounded JSON parsing,
and optional manifest SHA256/schema verification with resolved-path containment. Frozen strings are
planning requirements, not evidence that live configs satisfy them. `--design` permits read-only
validation of another artifact against this same contract. Invalid CLI input returns nonzero with a
bounded JSON error, no traceback or false success. Both readiness flags are always false.

Autonomous decisions: preserve every byte of the existing design; freeze current values rather than
invent a new experiment; allow cell reordering but no missing/extra/duplicate cells; limit each input
to 64 KiB and nesting to 16; reject bool/int coercion, duplicate keys, nonfinite JSON and nonregular
files. Tests use only synthetic data; no fixture assets copied into this repository.

## Tests and limits

- `python scripts/evaluation/check_classifier_design.py --self-test --fixture-root ../ai-workflow-evaluation-ready`
  — 10 tests pass; actual frozen manifest digest and exact cells verified.
- `python -O scripts/evaluation/check_classifier_design.py --self-test`
  — 10 tests pass; manifest correctly reported unverified without fixture root.
- Each run includes adversarial leaf/type mutations, missing/extra object fields, malformed cells,
  source/hash/path drift, absent/changed manifest, symlink escape, bounded JSON and seven real `-O`
  subprocess cases (valid, missing-cell/wrong-model, duplicate-key, bool-as-number, malformed JSON, positive/negative exponent overflow).
- Initial depth test failed because this Python parser accepted 1,500 nested arrays; explicit depth
  validation was added and both narrow suites rerun successfully. No broader run was pursued during
  that failure. No package dependencies installed or package/full runtime suites claimed.

The external manifest is not its fixture files or reference execution; source pins do not verify
Git checkout identity. No benchmark/model performance or full project success follows from these tests.
A concurrently hostile filesystem is outside this local offline validator's scope. Threshold remains
null; fixture composition, model/provider configuration, full task success, accounting, exact runtime
preflight, campaign authorization and final human merge approval remain separate unsatisfied gates.

Additional offline checks: Specplane validation is valid with zero errors and 258 inherited/current
warnings; `plan next` reports draft/action:none. Migration preservation passes for all 19 imported
specs and 6 preserved files, with 115 existing development allowance paths. Its first invocation
required `SPECPLANE_CLI`; rerunning with the existing verified local Specplane distribution succeeded
(CLI SHA256 `10d3df1682997cea7dde625f7640e9816a54b263aba3838d308e783fc6daea2f`).
`git diff --check` passes; design JSON and original specification bodies have no diff.

Independent-review correction: Python JSON exponent overflow (`1e999` / `-1e999`) produced infinity
without invoking the nonstandard-constant hook. Frozen schema checks already rejected these values,
but the parser's own nonfinite claim needed strengthening. Bounded traversal now requires every float
to be finite. Direct parser tests cover positive, negative and nested overflow; optimized CLI cases
cover both signs. Both 10-test suites (normal with actual manifest and `-O` without it) pass again,
now including seven optimized subprocess cases; whitespace check passes. No full package run.

Final parent and independent review: normal and optimized self-tests each pass10
cases (including seven real optimized CLI mutations); frozen external manifest
verification passes. The reviewer found exponent-overflow JSON could parse to
infinity even though the frozen schema rejected it; added explicit finite-float
validation and regressions before acceptance. No remaining blocker reported.
This is script-only work; unchanged package behavior is covered by the separately
recorded common baseline, not a claimed new live campaign. Plan stays draft.
