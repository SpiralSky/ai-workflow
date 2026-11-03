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
