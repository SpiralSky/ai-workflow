# Specification gaps

- Experimental addition: the architecture historically enumerated only llm/none although
  feature §7.2 permits classifiers. The user now explicitly requested typed classifier support.
  The optional classifier contract below is drafted without changing the default or claiming approval.
- Telemetry must represent missing provider token observations. Optional turn usage is deliberate;
  absent usage invalidates monetary completeness while retaining a known billed lower bound.
- Mixed direct TypeSafe/DeepSeek estimates require a separate provider-aware budget contract.
  Phase 1 rejects them rather than pretending billed and estimated values are comparable.

Composition preserves imported architecture body unchanged; the explicitly unapproved extension
is [recorded separately](../../docs/spec-extensions/typed-classifier-reranker.md). This is an
autonomous reversible documentation placement decision, not user approval.
