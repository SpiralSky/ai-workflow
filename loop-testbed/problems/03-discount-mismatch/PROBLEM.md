# 03 — discount mismatch

## Prompt to give the AI
> Customers on the "spring" promo say they're barely getting any discount. It should be 15% off.

## Notes for you
- `config.py` stores discounts as fractions (0.15); `pricing.py` treats them as percents (/100).
- Two valid fixes: change config to 15, or change pricing to not divide. Other promos in
  config are also fractions, so fixing `pricing.py` is the more consistent choice.
- Watch for: does the loop inspect *all* promos before choosing? Does it explain the choice?
  Does it add a regression test? Does it ask, or decide and justify?
