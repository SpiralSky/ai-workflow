---
fixWords: [leaf, facade, acyclic]
---
# Reference approach

Manually separate rounding arithmetic, rule/context types, promotions and tax policy. Put shared line operations below the rule and promotion layers, and shipping helpers in their own small module. Keep quote assembly in pricing.py as a facade over these acyclic dependencies. Every previous public export remains available through the unchanged package initializer. Move function bodies without changing their algorithms; manually choose imports and ownership, including private helpers. Extra lines and shipping modules are an implementation choice, not required by the checks.

The clean base already supplies the complete task; no overlay is needed. The prompt exposes the requested group ownership and 350-line ceiling. Reference partition and imports are authored independently of the structural and behavior checks. Checks retain the original regression suite, public exports and import-time behavior. Lazy variants to reject: forwarding modules over the untouched monolith; splitting definitions but dropping a previous public export. The static dependency check also rejects cycles even in unreachable imports.
