<!-- GENERATED FILE — do not edit by hand. Regenerate with: specplane generate -->

# Plans

## Active plans

| ID | Title | Status | Dependencies | Specs |
|----|-------|--------|--------------|-------|
| [2026-11-01-all-provider-host-broker](2026-11-01-all-provider-host-broker/PLAN.md) | Keep orchestration credentials and inference on the host | draft | — | architecture/runner, feature/framework-runner |
| [2026-11-01-classifier-evaluation](2026-11-01-classifier-evaluation/PLAN.md) | Fair offline classifier evaluation design | draft | — | feature/orchestrate, feature/framework-runner, architecture/orchestrate-engine, architecture/runner |
| [2026-11-01-direct-deepseek](2026-11-01-direct-deepseek/PLAN.md) | Direct DeepSeek provider with bounded estimates | draft | — | architecture/runner, architecture/framework-server, feature/framework-runner |
| [2026-11-01-direct-typesafe-classifier](2026-11-01-direct-typesafe-classifier/PLAN.md) | Direct TypeSafe tool filtering with explicit mixed estimates | draft | — | architecture/runner, architecture/orchestrate-engine, feature/orchestrate |
| [2026-11-01-failfast-campaign](2026-11-01-failfast-campaign/PLAN.md) | Stop evaluation campaigns on first terminal failure | draft | — | architecture/runner, feature/framework-runner |
| [2026-11-01-openai-plan-signin](2026-11-01-openai-plan-signin/PLAN.md) | Sign in with ChatGPT for workflow runs | draft | — | architecture/runner, architecture/framework-server, architecture/system-overview, feature/framework-runner |
| [2026-11-01-provenance-readiness](2026-11-01-provenance-readiness/PLAN.md) | Attest actual evaluation runtime inputs before model work | draft | — | architecture/runner, feature/framework-runner |
| [2026-11-01-specplane-migration](2026-11-01-specplane-migration/PLAN.md) | Experimental Specplane migration | draft | — | feature/harness-integration, feature/framework-runner |
| [2026-11-01-tool-env-secrets](2026-11-01-tool-env-secrets/PLAN.md) | Keep direct provider environment secrets out of local tool children | draft | — | architecture/system-overview |
| [2026-11-01-typed-classifier-reranker](2026-11-01-typed-classifier-reranker/PLAN.md) | Typed classifier tool reranking | draft | — | architecture/orchestrate-engine, feature/orchestrate |

## Archived plans

_None._

## Dependency graph

```mermaid
graph TD
    p_2026_11_01_all_provider_host_broker[all-provider-host-broker]:::draft
    p_2026_11_01_classifier_evaluation[classifier-evaluation]:::draft
    p_2026_11_01_direct_deepseek[direct-deepseek]:::draft
    p_2026_11_01_direct_typesafe_classifier[direct-typesafe-classifier]:::draft
    p_2026_11_01_failfast_campaign[failfast-campaign]:::draft
    p_2026_11_01_openai_plan_signin[openai-plan-signin]:::draft
    p_2026_11_01_provenance_readiness[provenance-readiness]:::draft
    p_2026_11_01_specplane_migration[specplane-migration]:::draft
    p_2026_11_01_tool_env_secrets[tool-env-secrets]:::draft
    p_2026_11_01_typed_classifier_reranker[typed-classifier-reranker]:::draft
    classDef draft fill:#f9fafb,color:#374151,stroke:#d1d5db
    classDef ready fill:#22c55e,color:#fff
    classDef blocked fill:#ef4444,color:#fff
    classDef in_progress fill:#3b82f6,color:#fff
    classDef review fill:#60a5fa,color:#fff
    classDef done fill:#9ca3af,color:#fff
    classDef abandoned fill:#9ca3af,color:#fff,text-decoration:line-through
```
