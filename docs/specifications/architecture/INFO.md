# Architecture Specifications

Architecture specs resolve **how** the features in [`../features/`](../features/INFO.md) are built:
components, processes, packages, interfaces and data formats. For this experimental migration, architecture specs drive implementation detail and feature specs
remain authoritative for user-visible behaviour. A contradiction blocks the affected behaviour,
not independent work; record it for resolution rather than silently choosing either side. This
reversible policy mapping follows Specplane and does not approve any spec or final merge.

Architecture specs describe the target system. They do not describe or depend on the current code.

---

## Index

| File | Covers | Derived from |
|------|--------|--------------|
| [system-overview.md](system-overview.md) | Components, process topology, repository layout, runtime choices, dependency rules | all |
| [core-branch.md](core-branch.md) | Branch runtime: compile, instrument, execute, trace, render | branching-framework |
| [core-tools-and-hosts.md](core-tools-and-hosts.md) | Tool registry, declarations, harness-tool adaptation, `Host` interface, wrapper stack, check step | branching-framework §6, harness-integration §4, tools §3–4 |
| [orchestrate-engine.md](orchestrate-engine.md) | Planner tools, selection pipeline, executor loop, reports, references store, change tracking | orchestrate, references |
| [telemetry.md](telemetry.md) | Reporter, event schema, sinks, transcripts, rollups | framework-runner §4–5 |
| [runner.md](runner.md) | CLI, job lifecycle, model loop, containers, grading, retries, budget, staged evaluation | framework-runner |
| [tool-catalog.md](tool-catalog.md) | Tool implementations (tiers S/L), Python analysis sidecar, fixtures, base image | tools |
| [problems.md](problems.md) | Problem build pipeline, codebases + overlays, self-check, images | problems |
| [framework-server.md](framework-server.md) | MCP framework server, host kinds, call channel, policy, Claude Code plugin | harness-integration |
| [viewer.md](viewer.md) | Indexer, static data loading, app structure, renderer registry, watch mode | viewer |
| [data-formats.md](data-formats.md) | Run directory files, event/transcript records, combined report | framework-runner §7, viewer §9 |

---

## Markers

Items that need the user's decision are marked inline, in the place they apply:

| Marker | Meaning |
|--------|---------|
| `> **[APPROVAL A-nn]**` | An architectural choice made here that the feature specs leave open. A recommendation is given; it is **not** final until approved. |
| `> **[INPUT I-nn]**` | A question the architecture cannot answer without the user (preference, budget, or an open question carried over from a feature spec). |
| `> **[CONFLICT C-nn]**` | An inconsistency found between feature specs, or between a spec and project files. Needs a fix in the named file. |

When an item is resolved, replace the marker with the decision (and date) and remove its row below.

---


### Approvals

None open.

### Inputs

None open.

### Conflicts

None open.
