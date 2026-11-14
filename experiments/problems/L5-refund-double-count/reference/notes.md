---
fixWords: [subscribe_once, registration, report-refund]
---
# Reference approach

The CLI loads reports, whose package initializer enables reporting in events.handlers. Existing and future application buses then receive the refund callback under a second registration key. Distinct partial objects would not deduplicate by callable identity. Each registration key tracks processed refund IDs in the repository so replay, including after unregister/re-register, is harmless; distinct keys have separate tracking. Both callbacks record a posting, so the monthly report faithfully sums two postings for one refund.

The hand-authored reference uses the same subscribe_once key for the reporting path and the normal application path. It leaves accounting and reporting unchanged and works whether the CLI/report package loads before or after a bus is created. The overlay adds posting records plus their monthly-report consumption to make duplicate dispatch observable; persisted legacy refunds without postings retain their original accounting behavior. Weakly held buses let activation reach live applications without retaining discarded buses; unregistering an application removes it from that activation registry.

Independent checks exercise fresh API-only and CLI startup orders, repeated initialization, two buses, multiple legitimate refunds, correct monetary totals and callback/posting counts. Lazy variants: deduplicate report entries without fixing dispatch; disable refund callbacks to suppress the symptom. Both violate the observable contract.
