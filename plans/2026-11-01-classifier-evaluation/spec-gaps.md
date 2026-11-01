# Experimental gaps and precedence

1. Historical feature/orchestrate §12 mentions cost per successful job. Latest user specifically
   requires full-task success and rejects cost-per-success optimization: use full required cells
   as the fixed denominator, and rank cost only after all cells succeed with unchanged quality.
   Original spec text/approval history is preserved, not silently edited.
2. Current completion adds one-level `requires`; it is not recursive closure. Keep this exact
   behavior equal in every arm. Diagnose nested/missing dependencies separately; if fixing core
   behavior becomes necessary, apply it to every arm before a new comparable campaign.
3. These exposed authored fixtures are regression evidence, not untouched generalization holdout.
   No claims of unbiased external model quality follow from them. Do not tune thresholds on them.
4. Classifier threshold/phase2 direct-TypeSafe accounting still depends on implementation. Null
   threshold in design means unready, not automatic default. No guessed live output/price savings.
