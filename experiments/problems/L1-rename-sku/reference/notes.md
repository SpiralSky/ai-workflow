---
fixWords: [tokenize, token, __all__]
---
# Reference approach

Rename Python NAME tokens from Sku to ProductCode in source and visible tests. Preserve lowercase sku attributes, JSON keys, strings and stored fixtures. Keep exports in every formerly importing module. The checks retain an independent renamed regression suite so deleting or weakening visible tests cannot satisfy grading. The prompt deliberately names both requested type names; these are the task, not leaked implementation instructions. Avoid blind text replacement; the reference uses Python tokenization. `__all__` in `fulfil/models/__init__.py` must list `ProductCode`.
