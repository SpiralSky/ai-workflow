---
fixWords: [propagate, explicit, symbol_map]
---
# Reference approach

Keep USD as the formatter default. Add the explicit display-currency argument and propagate order.currency through invoice helpers, notification templates and order-related API handlers. Leave product-only displays, reports and CLI calls alone: a Money value alone does not change the default. A small symbol_map handles the three supported currencies without conversion or rounding changes.

No overlay is needed: the base already has many meaningful formatter call sites, including numeric zero fallbacks and derived amounts. The hand-authored reference updates 30 order-context calls in three consumers. Independent behavior checks cover invoices, emails, API operations and unchanged default/cross-currency reports. Lazy variants: change only the formatter default to EUR; fix invoices but omit email/API propagation. Neither solves the full request.
