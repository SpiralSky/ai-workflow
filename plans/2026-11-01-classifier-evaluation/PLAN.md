---
id: 2026-11-01-classifier-evaluation
title: "Fair offline classifier evaluation design"
status: draft
specs: ["feature/orchestrate", "feature/framework-runner", "architecture/orchestrate-engine", "architecture/runner"]
---

# Fair offline classifier evaluation design

## Goal

Compare existing LLM/none rerank against typed classifiers without weakening full-task success,
grading, approval boundaries or cost accounting. This is a draft design, not execution authority.

## Scope

A frozen comparison design, offline invariants and readiness checklist. Keep the existing60 target
cells on the separate full-fixture branch; do not copy benchmark fixture assets into this branch.
Retain failures, fallback diagnostics and all-role spend. No cost-per-success optimization.

## Non-goals

Live calls/spending, model-output simulation presented as measured quality, new provider implementation,
finalizing/approving this plan, merging, changing task checks or manufacturing a winner.

## Acceptance criteria (not approved)

- [ ] Same retrieval input/pool/K, shortlistN, dependency completion and task/check hashes per arm.
- [ ] Explicit per-stage recall/omission and recovery/fallback diagnostic definitions.
- [ ] Every target cell and attempt retained; full success plus quality before cost ranking.
- [ ] Provider reported costs, estimates and unknowns separated across every agent role.
- [ ] Offline contract checks remain distinguishable from genuine provider/task evidence.
- [ ] Separate source/fixture composition and campaign authority remain required gates.

## Steps

1. `design`: record comparison artifacts and verify offline structural invariants in this isolated experimental branch.
2. `preflight`: after implementation/fixture integration, review exact artifacts and offline full suite; keep this plan draft.
3. `evaluate`: only after distinct campaign authorization and valid credentials/bounds, collect matched full-task evidence; this step is not authorized here.
