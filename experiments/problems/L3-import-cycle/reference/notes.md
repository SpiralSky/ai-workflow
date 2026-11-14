---
fixWords: [lower, shared, dependency]
---
# Reference approach

The new order-event reporting path forms api → services.orders → events.handlers → reports → api. Reporting imports OrderEventData before the API package has defined it. Move this shared immutable value type to a lower model module, then import it from both reporting and the original API export location. Keep the event-building and reporting functions intact. The reference changes ownership and dependency direction, not behavior, and adds no delayed imports.

The overlay adds the reporting feature and a visible behavior test. The independent checks retain all original regression tests plus that visible contract. They scan the import graph and reject imports inside functions in any changed source file. Lazy variants: delaying the reporting import inside the event builder; deleting the reporting/event API to remove the cycle. Neither meets the task.
