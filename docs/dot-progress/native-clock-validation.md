# Native clock validation: experimental draft

Base: 28a92f3ece3e5f502a5447281070100908a2caed plus the restored, reviewed diagnostics-only patch. Work is isolated on dot/native-clock-hardening-20261105. No main, spec approval, merge, actor or grader is involved.

## Findings and fix

The original rejected sample was not retained. Its cause remains unknown. The 20 ms check measures the wall-time bracket around the boot-ID and uptime reads, not disagreement between clocks. The separate 60 ms check compares elapsed wall and uptime values.

Synthetic regression tests found a different, reproducible validation defect: NaN wall observations evade ordered comparisons, and nonfinite inputs or overflowing arithmetic can pass the lifetime checks or return NaN. The fix explicitly requires finite numeric wall bounds, sampling skew, lifetime inputs, elapsed values and both remaining bounds. This tightens acceptance only for invalid numeric data. It does not fix a demonstrated long-bracket failure.

The read order remains wall, boot ID, uptime, wall. The 20 ms sampling limit, 20 ms precision margin, 60 ms drift allowance, original deadlines, min-of-two-budgets calculation, failure persistence and no-retry behavior are unchanged. No boot-ID caching or reordering is introduced.

## Validation and measurement limits

Before the fix, 10 of 12 new synthetic controls failed. The final run passed all 22 controls: the nine restored diagnostic controls and 13 new validation controls, including overflow of one remaining bound when the other remains finite. The existing pure dual-budget control also passed, and all four changed/new JavaScript files passed syntax checks. These controls mock clock reads or use fixed input values; they do not certify the real transport.

One separately authorized, count-bounded standalone characterization ran before the finite-value fix, using the restored sampler unchanged. All 32 samples passed with brackets of 0 or 1 ms. The enclosing same-process monotonic duration ranged from about 0.111 to 0.670 ms. This is evidence only for those current samples in the reset environment. It neither explains the historical rejection nor establishes future stability, helper admission, or a completed baseline. No additional live sampling is justified by the passing result itself.

The restored configuration names scripts/test-cloud.mjs, but that file and installed workspace dependencies are absent from this source recovery. Focused built-in Node controls and syntax checks are available; a repository-wide aggregate pass is not claimed.

## Sources

- [ECMAScript Number.isFinite](https://tc39.es/ecma262/2025/multipage/numbers-and-dates.html#sec-number.isfinite) and [numeric comparisons](https://tc39.es/ecma262/2025/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-lessThan) explain the invalid-number case.
- [Linux timekeeping](https://docs.kernel.org/core-api/timekeeping.html) distinguishes real, monotonic and boot time; these sources do not prove this sandbox's clock domains match.
- [Linux boot ID documentation](https://docs.kernel.org/admin-guide/sysctl/kernel.html#random) supports considering boot-ID reads separately, but reordering would change the existing acceptance contract and was not implemented.
- [Node process.hrtime](https://nodejs.org/api/process.html#processhrtimebigint) supports the separate duration measurement; it was not substituted for the guarded wall sample.

Remaining blocker: the original environmental failure has no retained numeric sample, and these changes do not establish a safe real-screening retry. A new matched source pin and the existing preflight/admission requirements remain necessary before actor work.
