# Procedural action selection

**Status:** Exploratory design, 2026-11-13. Not an implementation specification.  
**Related:** [Orchestrate](../specifications/features/orchestrate.md), [known-good hot paths](known-good-hot-paths.md)

## Goal and intuition

Make familiar development procedures cheap and seamless to invoke, rather than repeatedly asking a general-purpose model to reconstruct how to perform them. Tools are the means of expressing and executing these procedures; expanding the tool catalog is not the end goal.

The analogy is human muscle memory: a developer learns to combine Bash, an IDE's file explorer, navigation, edits, and checks into fluent sequences. Feedback improves those habits. LLMs already have something similar in their learned use of shell commands and coding tools. The aim is to extend this fluency to a richer ecosystem of actions without requiring new model training first.

A decision tree and vector search are alternative ways to retrieve the appropriate action externally. Neither is the core idea by itself. Both approximate access to procedural knowledge that could instead be internalized through SFT. Reward-based training is another possible later route to improving procedure use.

## Intended design

1. Describe the current situation and the desired operation using relevant task context and observations.
2. Select an action or reusable procedure. Candidate mechanisms are hierarchical decisions using Jev, vector retrieval, or a flat selection pass when the candidate set is small enough.
3. At the final pass, give a separate small generative LLM the selected action's definition and relevant context. It fills in the tool arguments or other concrete information needed to execute it.
4. Execute the actual tools, observe the results, and continue through the procedure's defined transitions. A procedure may combine several tools; selecting it does not itself execute those calls.
5. Return for additional reasoning when the procedure cannot resolve what comes next.

Jev supplies typed selection decisions. It is not being asked to generate arbitrary arguments or code. The final generative pass is an acknowledged remaining difficulty: selecting the right action does not automatically make its arguments correct. A 4–8B model is a candidate for this narrow role, not an established capability result.

### Decision tree option

Describe the situation clearly enough that Jev normally selects one branch. Descend through progressively narrower choices until reaching the relevant action. Well-designed action boundaries and less overlap should make this easier.

When several branches have high probabilities, explore those branches through further Jev decisions in parallel. Two or three branches were examples, not a fixed branching factor or a requirement to fan out at every level. The intended common case is a single path.

The hypothesis is that hierarchical selection makes a large catalog manageable while keeping each request small, and that Jev's low cost makes selection a minor part of the total bill. Neither near-zero total routing cost nor superiority over flat selection has been established for this workload.

### Vector search and flat selection alternatives

Keep vector search as a potential alternative if it retrieves suitable actions reliably. It can retrieve procedures from descriptions of the current situation, optionally followed by a Jev selection pass over a shortlist. A flat selection pass is another option for smaller candidate sets.

Decision trees and vector search serve the same purpose here: finding the action. The procedure definitions, final argument-filling stage, execution runtime, and shared state should not depend on which retrieval mechanism is used. Compare their ability to find usable actions before choosing one permanently.

The current orchestrate implementation uses BM25 retrieval; retaining vector search as an idea does not imply that a vector implementation has already been validated.

## Actions and execution

Actions should represent concrete, reusable operations, with explicit preconditions, required inputs, tool calls and dependencies, outcome checks, and exits or recovery paths. A broad instruction such as “fix the bug” is not a suitable action definition.

An illustrative procedure is renaming a known symbol: resolve its definition, handle ambiguity, find references, perform the rename, and run relevant checks. The runtime can carry predictable transitions forward without asking the main model to manage each call. The exact action format and runtime behavior remain to be designed.

Some tools may themselves use a small LLM as glue, for example to generate a bounded code fragment or adapt a known transformation to concrete source code. This is analogous to asking AI to produce a binary-search function instead of writing it manually. Such tools improve versatility; they should not conceal an unrestricted agent tasked with solving the whole problem.

The user accepted executable procedures and bounded LLM-backed tools as part of the direction. The division between deterministic argument extraction and generative argument filling remains open.

## Clarifications from the discussion

- **Selection versus execution:** The assistant's distinction was that following several branches to identify candidate actions does not require executing every candidate's effects. For example, exploring two possible repair procedures is different from applying both repairs. The user requested clarification of this point; the detailed policy for parallel execution is not yet agreed.
- **Branching:** The user expects precise situation descriptions and well-separated actions to produce one selected branch most of the time. A mandatory three-wide search or a beam-search architecture is not part of the proposal.
- **Selection failures:** The intended operating assumption is that Jev usually chooses a suitable action. A wrong selection is treated as an ordinary tool-use failure, comparable to an LLM occasionally choosing the wrong tool. Rare failure is an expectation to test, not a measured result. An elaborate expected-utility router or recovery planner is not an agreed requirement.
- **Training:** The motivation for external selection is to avoid the cost and practical burden of training procedural fluency into a model now. RLHF is not inherently restricted to local hosting, and SFT, RLHF, and reward-based training are distinct options. No claim is established here about the private training methods used for Claude Code or OpenAI tools.

## Insights and open questions

### Remove repeated planning, not just selection cost

Cheap routing alone will not remove orchestrate's overhead if the main model still has to formulate, issue, and interpret every individual operation. Executable procedures offer a way to amortize that reasoning across a useful unit of work. Small tasks should often fit into one or two delegations rather than three or four; this is an intended outcome, not a hard limit.

### Preserve context across procedures

Fresh executor sessions were a cost driver in the existing design. A proposed improvement is persistent task state containing observations, file versions, tool results, and completed actions, with only relevant evidence supplied to each decision or generation pass. Edits must invalidate stale content. This is an assistant suggestion; its representation and retrieval policy are not settled.

### The final argument pass is a real boundary

Filling known paths and symbol names is different from discovering which symbol causes a bug. The action and its context must leave a sufficiently narrow problem for the small model. Missing information may require an explicit inspection action before argument generation. Check both argument validity and the resulting behavior; correct selection alone is insufficient.

### Measure the whole route

More tree levels reduce descriptions per request but can add requests and repeated context. Occasional parallel paths also contribute to cost. Measure complete routing cost and latency rather than inferring them from the price of one small Jev call. Selection confidence should be checked against actual action suitability on representative cases.

### Specialized tools need a practical advantage

Bash may already be sufficient for many operations because models have learned it well. A richer action library earns its place by reducing reasoning, interactions, errors, or execution effort. Merely reproducing familiar shell capabilities behind unfamiliar names may not help. Branch-only already supplies batching and output filtering, so it is an important comparison alongside baseline and orchestrate.

### Compare mechanisms without changing everything else

A useful proposed experiment keeps procedures, task context, argument model, and execution behavior constant while comparing hierarchical Jev selection, flat selection, and vector retrieval with any optional reranking identified separately. Measure action-selection success, argument correctness, completed-task success, total cost including failures, and main-model interventions. Start with a small useful procedure set before committing to a large hierarchy.

The prior recorded small-task comparison put orchestrate at roughly six times baseline cost, before later changes aimed at reducing delegation and rereads; this is not a current-version benchmark. Larger codebases, longer tasks, and larger catalogs test different possible benefits. More repetitions of small tasks improve confidence but do not themselves establish those scaling benefits. See the [historical comparison and follow-up changes](../../HANDOFF.md).

## Reference

[TypeSafe introduction](https://docs.typesafe.ai/introduction) describes Jev's state-plus-typed-questions interface, structured decisions, and support for multiple questions in one request. It supports the selection role used here; it does not establish this design's task accuracy or total cost.
