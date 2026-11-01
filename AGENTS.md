<!-- specplane:begin v1 — managed by `specplane init`; edits inside this block are overwritten -->
## Specplane

This repository uses Specplane. Before acting on specs, plans, or ADRs, read `.specplane/config.yaml`; resolve every path from it (`spec_roots`, `plans.dir`, `decisions.dir`), never assume one. `execution` says how plans run.

- **Authorship**: `specs.<type>.llm_role` limits what you may do to specs of that type: `none` = do not act on them, decline and say why; `review` = ask, suggest, and review, but do not write the spec body; `assist` = write the body only after the user finalises the content and approves the text (refine-then-write); `draft` = you may write a draft for review. Setting a spec to `approved`, a plan to `ready`, or a decision record to `accepted` is the human's decision: never do it by editing a file.
- **Precedence**: when implementing, the architecture spec wins and the feature spec fills gaps; record each gap, assumption, or proposed spec edit as a `spec-gaps.md` entry in the plan folder. If specs contradict each other, stop and report it; do not implement either side.
- **Plans**: work on a plan only in its checkout (branch `plan/<id>`), one step at a time, following the plan-step workflow. HANDOFF.md and `spec-gaps.md` in the plan folder are the source of truth for progress and gaps.
- **Commits**: follow `architecture/file-formats` §8 (Conventional Commits subject plus `Specplane-*` trailers).
- **Workflows**: use the CLI workflows in `.agents/skills/specplane/SKILL.md`; no Claude slash commands, permission grants, or background Codex adapter are installed.
<!-- specplane:end -->

## Experimental development authorization

The user permits experimental spec development and parallel candidates without spec approval.
Do not set specs approved, plans ready/done, or decisions accepted; never run approve, finish,
merge, cleanup, or branch deletion commands. The final merge requires explicit human approval.
Keep plan records draft while recording actual work in docs/dot-progress. An inability to start
a draft plan does not prevent independently authorized experimental development on isolated
branches. Read CLAUDE.md for project test/model/budget requirements.

Framework contract IDs in the managed block refer to the external pinned Specplane distribution,
not ai-workflow architecture IDs. See docs/dot-progress/migration-decisions.md.
