# Gaps and autonomous decisions

- Existing historical HANDOFF references a 7-task model run and old cost accounting;
  preserve it as history, do not use it as the new 60-cell baseline.
- Hot paths are spec-adopted but framework wiring still refuses the variant. Keep
  implementation status separate from adoption and avoid duplicating existing
  tool discovery/reference mechanisms.
- Selector reuse needs explicit task and state/reference revisions not currently
  supplied by the engine. Prototype remains opt-in and unwired; do not guess them.
- A parallel local tool test failed its startup-output assertion. Serial test-file
  scheduling is an explicit experiment with all assertions retained, not proof of
  a production fix or permission to omit failed runs.
