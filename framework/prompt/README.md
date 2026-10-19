# framework/prompt

Source fragments assembled by `bin/build-prompt` into the appended system prompt used by branch sessions.

## Source files

| File | Purpose |
|------|---------|
| `tool.md` | Branch tool description — the opening paragraph injected at `# Branch tool`, plus the `Helpers:` header and opening ` ```ts` fence |
| `helpers.d.ts` | TypeScript declarations for all helpers available inside branch programs; closes the ` ```ts` fence |
| `system-always.md` | Usage rules for **always** mode — branch is the only interface; every task goes through branch |
| `system-stub.md` | One-line stub for **stub** mode — branch is disabled; `/branch` loads the full instructions |
| `report-intent.md` | Change-report rule appended when `BRANCH_REPORT=intent` (default) |

## Generated files (gitignored)

`bin/build-prompt` assembles the source files into a single prompt file. Output path:

```
prompt/.system.{BRANCH_SYSTEM}-{BRANCH_REPORT}.md
```

Valid combinations:

| `BRANCH_SYSTEM` | `BRANCH_REPORT` | Output file | Contents |
|-----------------|-----------------|-------------|---------|
| `always` (default) | `intent` (default) | `.system.always-intent.md` | tool.md + helpers.d.ts + system-always.md + report-intent.md |
| `always` | `none` | `.system.always-none.md` | tool.md + helpers.d.ts + system-always.md |
| `stub` | `intent` | `.system.stub-intent.md` | copy of system-stub.md |
| `stub` | `none` | `.system.stub-none.md` | copy of system-stub.md |

## Env vars

| Variable | Values | Default | Effect |
|----------|--------|---------|--------|
| `BRANCH_SYSTEM` | `always`, `stub` | `always` | Selects the usage-guidance section |
| `BRANCH_REPORT` | `intent`, `none` | `intent` | Whether to append the change-report instruction |

## How the generated file is used

`bin/install-project <dir>` writes an `@import` line to the project's `CLAUDE.md` pointing at the generated file:

```
@/path/to/framework/prompt/.system.stub-intent.md
```

(stub mode by default so branch starts disabled; `/branch` loads the always-mode instructions at runtime.)

`bin/claude-branch` also pre-builds both the stub and always variants before launching Claude, so `/branch` can switch modes without re-running `build-prompt`.
