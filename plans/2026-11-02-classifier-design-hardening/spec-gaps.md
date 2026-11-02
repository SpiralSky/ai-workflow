# Gaps, assumptions and autonomous decisions

1. **Optimization safety:** existing checker used `assert`, erased by `python -O`. Replaced with
   explicit `DesignError` validation. No original requirement body changed.
2. **Frozen draft contract:** existing code checked arm IDs but not requested models, completion,
   policy, fixedAcrossArms or source/hash pins. Pin the existing artifact's exact values in code;
   do not invent provider routes, thresholds, or main/secondary model values absent from the draft.
   Main/secondary models remain an uninstantiated fixed-across-arms requirement, not live settings.
3. **Strictness/bounds:** reject duplicate keys, unexpected fields, bool-as-integer, nonfinite JSON,
   nonregular/oversized input (64 KiB cap), depth over 16, malformed schemas and path escapes.
   Existing valid artifacts are far below limits. Array order is frozen except target cells,
   whose exact set and multiplicity are enforced. This is reversible hardening, not plan approval.
4. **Fixture attestation limit:** frozen digest pins complete manifest bytes including fingerprints;
   schema/cell checks also run. Does not verify checkout Git HEAD, actual fixture files, trusted
   reference execution or campaign readiness. Stable local filesystem assumed during inspection.
5. **Historical evaluation gaps:** full-task denominator, one-level completion, target exposure,
   null threshold and separate authority gates from the prior classifier-evaluation plan remain.
6. **Review correction:** nonfinite rejection must include standard JSON exponent overflow, not
   only NaN/Infinity tokens. Added explicit finite-float traversal checks and positive/negative/nested
   overflow regressions. Existing schema was already fail-closed; this closes the parser-level gap.
