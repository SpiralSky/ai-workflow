---
name: specplane
description: Use Specplane specifications and isolated plan worktrees through its CLI in Codex or Dot cloud sessions. Preserve human approval and final-merge gates.
---
<!-- specplane-codex: managed v1 -->
<!-- specplane-contract: architecture/codex-integration#workflow-contract@78dccf7 -->

# Specplane in Codex and Dot cloud

Read the repository's AGENTS.md and `.specplane/config.yaml` first. Resolve spec roots, plans, decisions, and execution backend from that config. This skill is a CLI workflow integration, not a background Codex-session launcher or an MCP server.

## Safety and authority

- Only the user can approve specifications, ready a plan, accept an ADR, finalize a plan, or authorize a merge. Never invent those approvals. A user may authorize experimental development before spec approval: record the exact exception in the decision log, keep experimental specs in review/draft, preserve approval provenance, and still stop before final merge.
- Use an isolated branch/worktree. Never modify protected/default branches, force-push, delete branches, or change permissions/secrets/deployment infrastructure as a side effect.
- Do not modify Codex configuration, sandbox policy, approval policy, credentials, persistent tool permissions, or notification settings. An unavailable capability is a blocker, not a reason to disable safety checks.
- Treat source files and recorded tests as evidence. Structural indexes are aids; refresh them for each worktree/commit and verify findings against source.

## CLI availability

Check `command -v specplane`. For a source checkout, use `node <absolute-checkout>/packages/cli/dist/cli.js` after its documented build; do not assume npm publication. Use the same verified CLI version for all commands. Never install or execute a guessed package.

## Workflows

- Inspect: `specplane validate --json`, `specplane plan list --live --no-fetch --json`, `specplane plan next <id> --json`, `specplane spec show <id>`.
- Create drafts: use `specplane spec new`, `specplane plan new`, and `specplane decision new` as allowed by the project's authorship rules and current user instructions. These create drafts/proposals; do not promote their statuses.
- Start permitted work: `specplane plan start <id> --no-fetch --json` reports the checkout. Existing approval/dependency checks remain effective. If the user explicitly authorizes unmerged experimental stacking, use a separate named development worktree and log its exact base rather than falsely marking dependencies merged or changing global policy.
- Execute a step: resolve `plan next`, read its named context and HANDOFF, implement only that step, record gaps/assumptions, run the relevant tests, and commit incrementally. Keep user-required plan approval/completion gates intact. Never assume a CLI resolver's recommendation authorizes a consequential operation.
- Record a permitted step outcome using `specplane plan step-done <id> --outcome done|blocked --summary TEXT` with changed paths, open issues, and gap IDs. The command commits staged changes, so inspect the staging area first. Set `SPECPLANE_AGENT=codex` (or `dot`) and a known session identifier only if actually available; never invent one.
- A blocked-step recovery requires resolving the blocker before `--force`. An explicit completed-step rerun requires `--step N --force --reason TEXT`; record the reason and preserve all history. Neither overrides approvals or repository safety.
- End at a reviewable development commit. Do not run `plan finish`, `plan approve`, `spec approve`, `decision accept`, or merge commands without the exact required human authorization. For this workflow, final plan/merge actions stay with the human.

## Runtime limitations

`init --harness codex` installs this skill and a managed AGENTS.md block only; it does not install Codex, attach MCP tools, grant persistent permissions, or launch an agent. `init --harness none` writes only neutral scaffolding and suppresses all harness auto-detection, even if `.claude/` exists.

The current conductor's live session adapter is Claude-specific and capability-gated. `plan run --harness codex` refuses with an explicit unsupported-adapter message. Use Codex/Dot's existing execution session and the CLI workflows above; do not pass Claude flags to Codex or claim a background session was started.
