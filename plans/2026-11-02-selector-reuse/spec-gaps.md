# Experimental gaps (not approved spec changes)

- G1: Architecture §4 has no decision-reuse policy. This is a separately labelled opt-in
  prototype; default selection is unchanged. No original spec body edited.
- G2: Framework owns one selector while Task owns reference/state. Existing engine queries do
  not carry task identity/revision. Wrapper requires exact scope-object ownership and explicit
  workspace/state and reference revisions; absence bypasses caching. **No runner/engine wiring**
  is claimed. Real integration must supply monotonic never-recycled revisions on all relevant
  writes/evictions, isolate lifetime, and dispose at task end. Do not infer revision from step count.
- G3: Generic LLM interface lacks enough provider/failure/accounting observations for safe reuse.
  Only built-in classifier marks validated successful requests with internal proof; other
  rerankers/custom selectors are unsupported and always miss. Failure attachments never invent
  charges; provider-level unknown costs remain unknown and must block monetary conclusions.
- G4: Model/provider weights can drift behind names. Explicit treatment identity must pin routing,
  model and configuration changes; observations are not exact-weight guarantees. Immutable pipeline
  config plus treatment/revisions key the cache; changing client external state without advancing
  treatment is outside this prototype's contract. No hidden fallback introduced.
- G5: A cached shortlist can preserve a poor decision. Deterministic equivalence is not quality
  evidence. Before any production adoption, separately authorize matched fixed60 full-task tests,
  all-attempt accounting and selection-miss analysis. Existing full-success gate is unchanged.
- G6: Concurrent use is rejected (not queued/shared); no coalescing. Cache retained serialized
  payload bytes and entry counts are bounded, but transient input cloning/serialization costs
  scale with catalog size. V8 serialization is local-only and not a portable disk cache.
