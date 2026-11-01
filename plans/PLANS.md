<!-- GENERATED FILE — do not edit by hand. Regenerate with: specplane generate -->

# Plans

## Active plans

| ID | Title | Status | Dependencies | Specs |
|----|-------|--------|--------------|-------|
| [2026-11-01-all-provider-host-broker](2026-11-01-all-provider-host-broker/PLAN.md) | Keep orchestration credentials and inference on the host | draft | — | architecture/runner, feature/framework-runner |
| [2026-11-01-failfast-campaign](2026-11-01-failfast-campaign/PLAN.md) | Stop evaluation campaigns on first terminal failure | draft | — | architecture/runner, feature/framework-runner |
| [2026-11-01-openai-plan-signin](2026-11-01-openai-plan-signin/PLAN.md) | Sign in with ChatGPT for workflow runs | draft | — | architecture/runner, architecture/framework-server, architecture/system-overview, feature/framework-runner |
| [2026-11-01-provenance-readiness](2026-11-01-provenance-readiness/PLAN.md) | Attest actual evaluation runtime inputs before model work | draft | — | architecture/runner, feature/framework-runner |
| [2026-11-01-specplane-migration](2026-11-01-specplane-migration/PLAN.md) | Experimental Specplane migration | draft | — | feature/harness-integration, feature/framework-runner |

## Archived plans

_None._

## Dependency graph

```mermaid
graph TD
    p_2026_11_01_all_provider_host_broker[all-provider-host-broker]:::draft
    p_2026_11_01_failfast_campaign[failfast-campaign]:::draft
    p_2026_11_01_openai_plan_signin[openai-plan-signin]:::draft
    p_2026_11_01_provenance_readiness[provenance-readiness]:::draft
    p_2026_11_01_specplane_migration[specplane-migration]:::draft
    classDef draft fill:#f9fafb,color:#374151,stroke:#d1d5db
    classDef ready fill:#22c55e,color:#fff
    classDef blocked fill:#ef4444,color:#fff
    classDef in_progress fill:#3b82f6,color:#fff
    classDef review fill:#60a5fa,color:#fff
    classDef done fill:#9ca3af,color:#fff
    classDef abandoned fill:#9ca3af,color:#fff,text-decoration:line-through
```
