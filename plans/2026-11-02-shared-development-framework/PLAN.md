---
id: 2026-11-02-shared-development-framework
title: "Compose shared development and acceptance gates"
status: draft
specs: ["architecture/system-overview", "architecture/runner", "feature/framework-runner"]
---

# Shared development framework

## Scope and authority

The user explicitly authorized merges **between development branches only**, and evaluation
including native dot assignments and local tests. This independent development checkout does not
approve specifications, ready/finish plans, accept decisions, merge a default branch, authorize
provider calls, or claim a known dot quota pool. No treatment is selected by this shared integration.

## Steps

1. Preserve the exact base and source parent histories with ordinary development merge commits.
2. Compose design-contract, test isolation, fixture-admission, and bounded native assignment gates.
3. Add omitted Python/native focused checks to the existing test path without dropping package tests.
4. Verify focused checks and one coordinated fail-fast serial aggregate; record actual evidence.
5. Hand off the reviewable development branch to the parent for authorized publication.

## Review criteria

- Original specification and migration-inventory bytes remain unchanged; runtime before-states remain anchored.
- New source deltas identify exact before/after hashes without rewriting historical evidence.
- Every Python/native gate checks exit and complete coverage; existing serial option and final typecheck remain.
- Selector-reuse and hotpath candidates remain independent and are not ancestors of this branch.
- Native local contract success is not solver-quality, provider-cost, billing, or fixed60 evidence.

This record stays draft. Actual work and tests are recorded in HANDOFF.md and
`docs/dot-progress/shared-development-framework.md`, not fabricated approval or checked completion.
