---
id: 2026-11-01-specplane-migration
title: "Experimental Specplane migration"
status: draft
specs: ["feature/harness-integration","feature/framework-runner"]
---

# Experimental Specplane migration

## Goal

Adopt Specplane metadata and development workflows without changing project requirements, runtime behavior, benchmark assets, or historical approval evidence. Final merge remains human-only.

## Scope

- Import existing spec bodies with explicit review status and source provenance.
- Validate with the enhanced Codex/cloud integration when available.

## Non-goals

- No runtime optimization, approval, finalization, merge, or deletion.

## Specs implemented

| Spec | Coverage |
|------|----------|
| feature/harness-integration | Preserve the executable framework and existing harness integrations. |
| feature/framework-runner | Preserve evaluation requirements and the inherited accounting fixes. |

## Acceptance criteria

- [ ] All 19 requirement bodies and historical review records are preserved.
- [ ] Enhanced Specplane validates the migrated checkout and resolves representative specs.
- [ ] Package tests and representative workflow checks are recorded, with failures distinguished.
- [ ] No plan/spec is approved or finalized; no default branch changes occur.

## Risks

1. Existing Final evidence must not become fabricated Specplane approval.
2. Integration initialization must not expand permissions or overwrite runtime plugins.
3. CLI smoke checks are not a measured full benchmark run.

## Steps

1. `metadata-and-policy`: preserve requirements and map experimental policy.
2. `enhanced-workflow-validation`: test the actual enhanced framework and record results.

## Execution record

This remains a draft review artifact. Independent experimental work is authorized by the user
and recorded in `docs/dot-progress/migration-decisions.md`; this file is not an approval or
claim that the plan workflow executed.
