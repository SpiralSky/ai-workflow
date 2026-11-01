---
id: 2026-11-01-tool-env-secrets
title: "Keep direct provider environment secrets out of local tool children"
status: draft
specs: ["architecture/system-overview"]
---

# Goal

Extend the existing §7 subprocess environment protection to direct DeepSeek/TypeSafe
and defensive ChatGPT-prefixed variables, including previously unfiltered ripgrep launches.
This is explicitly authorized experimental development; no approval or finalization is implied.

## Scope

- Shared prefix filtering, preserving custom `AIW_SECRET_NAMES` and ordinary environment values.
- Ripgrep availability probe and search execution use the same filter.
- Synthetic-only regressions at every Node tool spawn boundary and a real Python descendant.

## Acceptance (pending human review)

- [ ] New provider secrets do not cross local tool subprocess environment boundaries.
- [ ] Existing provider/custom filters remain effective without mutating the source environment.
- [ ] Search, shell, Git, snapshot and Python tool behavior remains compatible.

## Limits

Environment filtering is not a sandbox. It does not defend against shell startup files
reintroducing credentials, arbitrary credential files, same-user process inspection, or unknown
provider variable names not configured in AIW_SECRET_NAMES. Runner Docker environment allowlists
already exclude these host keys; this fix addresses direct/local tool invocation.
