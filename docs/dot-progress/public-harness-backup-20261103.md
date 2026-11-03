# Public-only harness backup (draft)

User-authorized partial public backup, based directly on published development
commit 9a7c02224106178e3940a5ac066af4660769a6e3. Selected source files are copied
from local reconstruction 3d34581d1fc274cbd17885302b202c6dcfced6c3; its unpublished
commit history is not merged or cherry-picked into this branch.

Included: native protocol, controller, supervisor, public bootstrap/handoff,
hotpath presentation, recovery checks, associated harness tests, public fixture
task contracts, starting workspaces, public tests and manifest.

Excluded: new private grader, hidden tests, reference patches, fixture-control
implementation, reconstruction inventory, detailed reconstruction/evaluation
notes, raw runs, native transcripts, credentials and dependencies. The private
bundle is retained separately. Existing already-public baseline history is not
rewritten. This export is not a full backup and cannot run full grading until its
private assets are restored locally. No test gate is weakened or silently skipped.

No plan approval, completion, PR merge, protected-branch change, paid model run or
Codex task is authorized or performed by this backup. Earlier source test results
do not establish this partial export's full test-suite success.

Export verification: 35/35 synthetic protocol/handoff/bootstrap tests passed,
with no skipped tests, native actors or model calls. These do not exercise private
grading or establish full suite success.

## Public refresh

Selected public action-receipt and native-only offline-checker changes copied from
reviewed local source 24f20eec2ed2bf8997b6dbaa6e7fca438f7cc4ed. Its private history,
grader, fixtures and detailed internal evidence notes remain excluded. The offline
checker requires an already installed, exactly pinned runtime and fails closed on
missing/drifted dependencies; this export installs nothing and bundles no runtime.

Fresh export checks: 57/57 synthetic protocol/handoff/bootstrap/receipt controls;
8/8 Python offline-launcher controls with the existing verified Python environment
and pyright1.1.414, zero skipped tests. Before that valid Python run, two invocation
setup failures executed zero tests: missing PYTHONPATH, then system Python missing
pyright metadata. The first full traceback was overwritten; its final import error
remains in tool history. The second failure and successful run have separate logs.
No full-export suite, live actor, task-success or comparative cost result is claimed.
