# Feature: Procedural Action Selection

Status: Draft, not approved

**Area:** Framework runtime  
**Related:** [idea](../../ideas/procedural-action-selection.md), [orchestrate.md](orchestrate.md), [problems.md](problems.md)

## 1. Summary

Select reusable, bounded development procedures rather than repeatedly planning individual tool calls. A procedure combines explicit inputs, preconditions, dependent tool calls, outcome checks and exits. Selection does not execute effects. The prototype is an opt-in offline module, not a fourth measured framework or a replacement for current orchestrate behavior.

## 2. Motivation

The hypothesis is fewer main-model interventions for familiar operations. Cost saving, selection accuracy and improvement over baseline, branch-only or orchestrate are not measured. Small procedures must earn their complexity by accomplishing useful work, not by wrapping arbitrary shell commands or unrestricted agents.

## 3. Procedure format

A versioned procedure has a stable ID, description, category, applicability text, required typed inputs, preconditions, and an ordered dependency graph of named steps. Each step names an allowed tool, binds its arguments from inputs or earlier results, and specifies an outcome check. Dependencies must exist, precede the step and be acyclic. Definitions are trusted program data; task text cannot supply executable code, tool names or transitions.

Steps declare effects (`read`, `write`, `exec`, `external`) consistently with orchestrate §6. The initial prototype executes steps serially. A successful check advances to the next dependent step. Explicit exits are `completed`, `does-not-fit`, `needs-input` and `failed`, with a bounded explanation and completed-step observations. Failed checks stop before subsequent effects. There is no automatic alternative-procedure retry, recovery planner or implicit rollback. Partial edits remain visible in the result.

Required inputs include concrete workspace-relative paths and operation-specific values such as an existing symbol and replacement identifier. Paths must remain inside the workspace; tools reject traversal and symlink escapes. Input checks occur before writes. Preconditions distinguish missing or ambiguous targets from runtime failures. An illustrative rename procedure inspects a known symbol, prepares identifier-aware edits, applies them and runs the supplied checks. Strings used as persistence keys must not be renamed implicitly.

## 4. Runtime and state

The runtime validates the definition and inputs, executes allowed tools against one workspace, stores step results and follows declared transitions without model calls. It carries observations within a procedure and exposes a structured result to its caller. File observations are invalid after edits; reread or revalidate them before reuse. The prototype does not promise durable cross-procedure state or rollback.

Return to the main model when required inputs are absent, applicability fails, a tool or outcome check fails, an ambiguity requires a choice, or the procedure completes. A wrong selection is an ordinary tool-use failure. The caller decides what to do next using the result; the runtime does not invent a plan or repeatedly select until something works. Existing caller permissions and resource limits still apply. A procedure is not permission to perform an external effect.

## 5. Selector interface

All selectors accept the same situation text and candidate procedure descriptors and return ordered candidate IDs, selection-request observations and an explicit no-fit result when appropriate. A classifier interface receives a typed choice request with situation and candidate descriptions; it returns candidate IDs with scores, never generated arguments or executable code. The initial tests use a deterministic classifier stub.

- **Flat:** one classifier request over the complete candidate set.
- **Tree:** classify categories, then classify procedures inside selected categories. One branch is the normal case. Only when multiple categories meet the documented high-score threshold are those descents considered in parallel. Selection parallelism does not execute procedures in parallel. No beam search or expected-utility router is introduced.
- **Retrieval:** existing BM25 ranks procedure descriptions using the same situation; optionally classify a fixed shortlist. BM25 is lexical retrieval, not vector search. A future vector retriever may implement the same interface without changing procedure execution or argument filling.

Reject unknown/duplicate IDs and invalid scores. Stable tie ordering makes offline runs reproducible. Report actual selection requests and the serialized UTF-8 input size of each request, including repeated context. These bytes are not model tokens or cost.

## 6. Argument filling

Copy known paths, symbol names, explicit replacement names and prior tool-result values by ordinary code. Validate types, identifiers, paths and required values before execution. Do not ask a model to restate known values.

Only unresolved narrow fields may be requested from a separate generative argument filler. It receives the selected procedure's input schema and relevant observations, not authority to select tools or execute effects. Its output is untrusted data and undergoes the same validation. If discovering the target requires reasoning beyond that schema, return `needs-input`; do not disguise investigation as argument filling. The prototype uses hand-supplied arguments and has no paid model adapter. Model-assisted development checks are labeled development checks, never experiments.

## 7. Measurement and validation

First validate procedure runtime behavior with deterministic offline tools and fixtures. Build problems per problems §3–§8, including fail-before/pass-after reference checks. Execute the rename procedure with hand-supplied arguments on L1 and report the actual check outcome separately from selector suitability.

An offline selection case file, separate from existing cases, covers the procedure catalog using non-reported-task intents. For flat, tree and BM25 report whether the expected procedure was selected, request count and per-request input bytes. Stubbed classification tests validate interfaces and control flow only; they do not measure Jev or another model's accuracy. Record ambiguity, no-fit, invalid responses, partial-effect failures and path safety cases.

A later measured comparison must keep tasks, models, permissions, tools, procedure definitions, argument filler and limits fixed across selector variants, with repeated paired runs against baseline, branch-only and orchestrate. Report task success, selection suitability, argument correctness, main-model interventions, all request/token categories, failures, total cost and latency. Apply existing framework-runner cost and failure reporting rules. No paid comparison, cost saving or quality improvement is established by this draft or its offline prototype.

## 8. Open questions

1. **Integration with orchestrate §7:** it currently selects tools for a fresh executor, not executable procedures. Recommend keep this module opt-in and offline until a separately approved integration design; reject silently changing the default pipeline.
2. **State persistence:** recommend procedure-local state initially; reject a new persistent executor/session service as an overnight prerequisite.
3. **Ambiguous tree scores:** recommend a documented configurable high-score threshold with single best branch when no score crosses it; reject mandatory multi-branch descent or beam search. Compare alternatives empirically later.
4. **Rename scope:** recommend token-aware Python identifier renaming for the first prototype, preserving string keys; reject blind text replacement. Symbol-binding correctness across arbitrary languages remains outside this prototype.
5. **Generative filler:** recommend an interface with no production model implementation yet; reject claiming hand-filled arguments demonstrate a small model's competence.
6. **Parallel effects:** recommend serial execution even when selection explores multiple branches. The idea note has not agreed a parallel mutation policy.
7. **Problem limits and measured mode:** retain existing problem limits and three reported modes. A procedure integration or limit change requires a later decision rather than an implicit experiment change.

## 9. Out of scope

Paid provider calls, provider/sign-in changes, harness or supervisor work, new evaluation infrastructure, model training, edits to existing specifications, unrestricted code generation, automatic recovery planning and production activation.
