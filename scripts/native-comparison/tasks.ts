/** A coordinator-owned fake-host step; no fixture text is sent in assignment briefs. */
export interface CaseCall {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

/** Required contract case, evaluated in a fresh branch state. */
export interface Case {
  id: string;
  state: Record<string, unknown>;
  calls: CaseCall[];
  expected?: unknown;
  expectedError?: string;
}

/** Public assignment and its separate, never-prompted local checks. */
export interface ComparisonTask {
  id: string;
  instruction: string;
  publicContract: string;
  toolNames: string[];
  cases: Case[];
}

const pathRule = `A safe file path is a string of 1..256 characters: it is not absolute, does not start with a drive prefix such as C:, contains no backslash or ASCII control characters (0..31 or 127), and every slash-separated segment is nonempty and is neither a single dot nor a double dot. The final segment contains only ASCII letters, digits, underscore, dot or dash. Validate paths before any operation that uses them.`;

const diagnosticContract = `Input state: {path: unknown}. ${pathRule}
Available tools only:
- await tools.check({path: string}) returns {diagnostics: Array<{path: string, line: number, severity: "error"|"warning", message: string}>, counts: {error?: number, warning?: number}, truncated?: string}. Counts are nonnegative integers; truncated, when present, is a nonempty explanation. The visible diagnostics may omit errors. There is no guarantee the reported location is safe.
- await tools.readFile({path: string, range: [number, number]}) returns numbered source text as a string. Ranges are inclusive and 1-based.
Return exactly {status, errorCount, truncated, firstError, context}, with no extra fields.
For invalid input path, make no tool calls and return {status:"unsafe-input", errorCount:null, truncated:null, firstError:null, context:null}.
Otherwise call check once. errorCount is counts.error or zero when absent; truncated is the exact explanation or null when absent. Find the first visible diagnostic whose severity is error, not merely the first diagnostic.
If no visible error exists, make no reads. status is clean only if errorCount is zero AND truncated is null; otherwise status is incomplete. firstError and context are null.
If that first error has an unsafe path or its line is not an integer in 1..1000000, make no read and return status unsafe-location with errorCount/truncated preserved and firstError/context null.
For a safe first error, read its own path once with range [max(1,line-2),line+2], exactly two neighboring lines on each side. Return status error; firstError is {path,line,message}, with message limited to its first 120 JavaScript characters; context is the returned text limited to its first 240 JavaScript characters. Preserve errorCount and truncated even if a visible error exists.
Do not run tests, edit files, retry tools, or inspect any other location. Unexpected tool errors must propagate; do not label them clean or incomplete. All statuses above are normal returned records, including safe refusals.`;

const locateContract = `Input state: {path: unknown, term: unknown}. ${pathRule}
term must be a nonempty string of at most 80 JavaScript characters, matched literally and case-sensitively, never as a regex.
Available tools only:
- await tools.readFile({path: string, range: [number, number]}) returns numbered source text as a string. A truncated read contains a line beginning exactly [truncated at line .
- await tools.findFiles({pattern: string, path: "."}) returns {files: string[], truncated?: string}; when present, truncated is a nonempty explanation. Returned paths are not guaranteed safe.
Return exactly {status,path,reason,lines,omittedVisibleMatches,truncated}, with no extra fields. Normally reason is null; lines is an array; omittedVisibleMatches is a number; truncated is a boolean.
For an invalid input path or term, make no calls and return {status:"unsafe-input",path:null,reason:null,lines:[],omittedVisibleMatches:0,truncated:false}.
First read the requested path once with range [1,80]. Only if this throws an error whose string contains the standalone word ENOENT, findFiles once with pattern equal to the original final filename and path ".". Any other error must propagate, without retry.
If the search has a truncated explanation, return unresolved with reason incomplete, path null, empty lines, omittedVisibleMatches zero, and truncated true; do not choose even one visible candidate. Otherwise, zero candidates gives unresolved/absent, multiple candidates gives unresolved/ambiguous, with the same empty fields and truncated false.
For exactly one untruncated candidate, validate its path and require its final filename to equal the original final filename. If invalid or mismatched, return status unsafe-location with path null, reason null, empty lines, omittedVisibleMatches zero, truncated false; do not read it. Otherwise read that candidate once with range [1,80]. Errors from this second read propagate; there is no further search or retry.
After a successful read, split its text on newline. Remove any truncation-marker lines (those beginning exactly [truncated at line ) from matching. Keep the remaining lines that literally contain term, in original order. Return status read, the actual path read, reason null, the first three matching lines each limited to its first 160 JavaScript characters, omittedVisibleMatches equal to max(0,matching-line-count-3), and truncated true exactly when a truncation-marker line was present. Count omitted visible matches before capping individual lines. No other reads, tools or mutations are permitted.`;

/** Two independently authored adaptation contracts; these are not benchmark tasks or reference solutions. */
export const TASKS: ComparisonTask[] = [
  {
    id: "diagnostic-record",
    instruction: "Produce a compact triage record from a static-analysis check. Read the source neighborhood around the first usable error, and distinguish an actually clean result from incomplete diagnostic evidence.",
    publicContract: diagnosticContract,
    toolNames: ["check", "readFile"],
    cases: [
      {
        id: "warning-only-complete", state: { path: "lib/codec.py" },
        calls: [{ name: "check", args: { path: "lib/codec.py" }, result: { diagnostics: [{ path: "lib/codec.py", line: 9, severity: "warning", message: "optional documentation" }], counts: { warning: 1 } } }],
        expected: { status: "clean", errorCount: 0, truncated: null, firstError: null, context: null },
      },
      {
        id: "error-after-warning", state: { path: "app/queue.py" },
        calls: [
          { name: "check", args: { path: "app/queue.py" }, result: { diagnostics: [{ path: "app/queue.py", line: 2, severity: "warning", message: "style note" }, { path: "lib/worker.py", line: 27, severity: "error", message: "missing handler " + "z".repeat(130) }], counts: { error: 4, warning: 1 }, truncated: "three diagnostics omitted" } },
          { name: "readFile", args: { path: "lib/worker.py", range: [25, 29] }, result: "    25\tcontext\n    26\tbefore\n    27\t" + "v".repeat(260) },
        ],
        expected: { status: "error", errorCount: 4, truncated: "three diagnostics omitted", firstError: { path: "lib/worker.py", line: 27, message: ("missing handler " + "z".repeat(130)).slice(0, 120) }, context: ("    25\tcontext\n    26\tbefore\n    27\t" + "v".repeat(260)).slice(0, 240) },
      },
      {
        id: "hidden-errors", state: { path: "src/rules.py" },
        calls: [{ name: "check", args: { path: "src/rules.py" }, result: { diagnostics: [{ path: "src/rules.py", line: 4, severity: "warning", message: "visible prefix" }], counts: { error: 2, warning: 8 }, truncated: "remaining diagnostics omitted" } }],
        expected: { status: "incomplete", errorCount: 2, truncated: "remaining diagnostics omitted", firstError: null, context: null },
      },
      {
        id: "zero-count-truncated", state: { path: "pkg/timer.py" },
        calls: [{ name: "check", args: { path: "pkg/timer.py" }, result: { diagnostics: [], counts: { error: 0 }, truncated: "result stream incomplete" } }],
        expected: { status: "incomplete", errorCount: 0, truncated: "result stream incomplete", firstError: null, context: null },
      },
      {
        id: "unsafe-diagnostic", state: { path: "src/report.py" },
        calls: [{ name: "check", args: { path: "src/report.py" }, result: { diagnostics: [{ path: "../private.py", line: 11, severity: "error", message: "outside location" }], counts: { error: 1 } } }],
        expected: { status: "unsafe-location", errorCount: 1, truncated: null, firstError: null, context: null },
      },
      {
        id: "unsafe-input", state: { path: "src/../private.py" }, calls: [],
        expected: { status: "unsafe-input", errorCount: null, truncated: null, firstError: null, context: null },
      },
    ],
  },
  {
    id: "located-line-record",
    instruction: "Collect a small set of literal matching lines from a requested file. Recover a missing filename only when search evidence identifies one trustworthy location; preserve uncertainty and output omissions rather than guessing.",
    publicContract: locateContract,
    toolNames: ["readFile", "findFiles"],
    cases: [
      {
        id: "existing-capped-matches", state: { path: "src/options.py", term: "[tag]" },
        calls: [{ name: "readFile", args: { path: "src/options.py", range: [1, 80] }, result: "     1\t[tag] first\n     2\ttag is not a literal match\n     3\t[tag] " + "q".repeat(180) + "\n     4\t[tag] third\n     5\t[tag] fourth\n[truncated at line 80 of 160; pass range to read more]" }],
        expected: { status: "read", path: "src/options.py", reason: null, lines: ["     1\t[tag] first", ("     3\t[tag] " + "q".repeat(180)).slice(0, 160), "     4\t[tag] third"], omittedVisibleMatches: 1, truncated: true },
      },
      {
        id: "unique-relocation", state: { path: "old/registry.py", term: "ACTIVE" },
        calls: [
          { name: "readFile", args: { path: "old/registry.py", range: [1, 80] }, error: "ENOENT: requested source is absent" },
          { name: "findFiles", args: { pattern: "registry.py", path: "." }, result: { files: ["lib/registry.py"] } },
          { name: "readFile", args: { path: "lib/registry.py", range: [1, 80] }, result: "     1\tactive\n     2\tACTIVE = true\n     3\tquiet" },
        ],
        expected: { status: "read", path: "lib/registry.py", reason: null, lines: ["     2\tACTIVE = true"], omittedVisibleMatches: 0, truncated: false },
      },
      {
        id: "ambiguous-relocation", state: { path: "gone/cache.py", term: "limit" },
        calls: [
          { name: "readFile", args: { path: "gone/cache.py", range: [1, 80] }, error: "ENOENT: missing" },
          { name: "findFiles", args: { pattern: "cache.py", path: "." }, result: { files: ["first/cache.py", "second/cache.py"] } },
        ],
        expected: { status: "unresolved", path: null, reason: "ambiguous", lines: [], omittedVisibleMatches: 0, truncated: false },
      },
      {
        id: "truncated-single-candidate", state: { path: "old/filter.py", term: "accept" },
        calls: [
          { name: "readFile", args: { path: "old/filter.py", range: [1, 80] }, error: "ENOENT: missing" },
          { name: "findFiles", args: { pattern: "filter.py", path: "." }, result: { files: ["lib/filter.py"], truncated: "other matches omitted" } },
        ],
        expected: { status: "unresolved", path: null, reason: "incomplete", lines: [], omittedVisibleMatches: 0, truncated: true },
      },
      {
        id: "unsafe-located-path", state: { path: "src/token.py", term: "value" },
        calls: [
          { name: "readFile", args: { path: "src/token.py", range: [1, 80] }, error: "ENOENT: missing" },
          { name: "findFiles", args: { pattern: "token.py", path: "." }, result: { files: ["../token.py"] } },
        ],
        expected: { status: "unsafe-location", path: null, reason: null, lines: [], omittedVisibleMatches: 0, truncated: false },
      },
      {
        id: "invalid-term", state: { path: "src/valid.py", term: "" }, calls: [],
        expected: { status: "unsafe-input", path: null, reason: null, lines: [], omittedVisibleMatches: 0, truncated: false },
      },
    ],
  },
];

// Expanded before any native dispatch. These cases sample each explicit contract branch and
// boundary; they do not claim exhaustive inputs, benchmark generalization, or hidden holdout data.
const unsafePaths: Array<[string, unknown]> = [
  ['nonstring', 7], ['null', null], ['empty', ''], ['overlong', 'x'.repeat(257)],
  ['absolute', '/tmp/source.py'], ['drive-prefix', 'C:source.py'], ['backslash', 'dir\\source.py'],
  ['control', 'dir/so\u0000urce.py'], ['delete-control', 'dir/so\u007furce.py'],
  ['empty-segment', 'dir//source.py'], ['dot-segment', 'dir/./source.py'],
  ['parent-segment', 'dir/../source.py'], ['bad-basename', 'dir/source?.py'], ['trailing-slash', 'dir/'],
];
const diagnosticEmpty = { errorCount: null, truncated: null, firstError: null, context: null };
const locatedEmpty = { path: null, reason: null, lines: [], omittedVisibleMatches: 0, truncated: false };
const diagnostic = TASKS[0], located = TASKS[1];
for (const [name, path] of unsafePaths) {
  diagnostic.cases.push({ id: `input-path-${name}`, state: { path }, calls: [], expected: { status: 'unsafe-input', ...diagnosticEmpty } });
  located.cases.push({ id: `input-path-${name}`, state: { path, term: 'needle' }, calls: [], expected: { status: 'unsafe-input', ...locatedEmpty } });
}

/** Fixed check fixture; expected output is authored separately from the solution's logic. */
function checkCase(id: string, result: unknown, expected: unknown): Case {
  return { id, state: { path: 'src/module.py' }, calls: [{ name: 'check', args: { path: 'src/module.py' }, result }], expected };
}

diagnostic.cases.push(
  checkCase('empty-complete', { diagnostics: [], counts: { error: 0 } },
    { status: 'clean', ...diagnosticEmpty, errorCount: 0 }),
  checkCase('hidden-errors-without-truncation', { diagnostics: [], counts: { error: 3 } },
    { status: 'incomplete', ...diagnosticEmpty, errorCount: 3 }),
  checkCase('missing-count-truncated', { diagnostics: [], counts: {}, truncated: 'partial stream' },
    { status: 'incomplete', ...diagnosticEmpty, errorCount: 0, truncated: 'partial stream' }),
);
for (const line of [0, -1, 1.5, 1_000_001]) {
  diagnostic.cases.push(checkCase(`invalid-error-line-${line}`, {
    diagnostics: [{ path: 'src/error.py', line, severity: 'error', message: 'invalid first' },
      { path: 'src/valid.py', line: 5, severity: 'error', message: 'must not skip to this error' }], counts: { error: 2 } },
  { status: 'unsafe-location', ...diagnosticEmpty, errorCount: 2 }));
}
for (const [name, path] of unsafePaths.filter(([, path]) => typeof path === 'string')) {
  diagnostic.cases.push(checkCase(`diagnostic-path-${name}`, {
    diagnostics: [{ path, line: 5, severity: 'error', message: 'unsafe first location' }], counts: { error: 1 }, truncated: 'partial' },
  { status: 'unsafe-location', ...diagnosticEmpty, errorCount: 1, truncated: 'partial' }));
}
for (const [id, line, range] of [['first-line-neighborhood', 1, [1, 3]], ['last-allowed-line', 1_000_000, [999_998, 1_000_002]]] as const) {
  diagnostic.cases.push({ id, state: { path: 'src/module.py' }, calls: [
    { name: 'check', args: { path: 'src/module.py' }, result: { diagnostics: [{ path: 'src/error.py', line, severity: 'error', message: 'short error' }], counts: {} } },
    { name: 'readFile', args: { path: 'src/error.py', range: [...range] }, result: `${line}\tcontext` },
  ], expected: { status: 'error', errorCount: 0, truncated: null, firstError: { path: 'src/error.py', line, message: 'short error' }, context: `${line}\tcontext` } });
}
const maxPath = 'x'.repeat(253) + '.py';
diagnostic.cases.push({ id: 'maximum-input-path', state: { path: maxPath },
  calls: [{ name: 'check', args: { path: maxPath }, result: { diagnostics: [], counts: {} } }],
  expected: { status: 'clean', ...diagnosticEmpty, errorCount: 0 } });
diagnostic.cases.push(
  { id: 'check-error-propagates', state: { path: 'src/locked.py' },
    calls: [{ name: 'check', args: { path: 'src/locked.py' }, error: 'EACCES: check denied' }], expectedError: 'EACCES: check denied' },
  { id: 'diagnostic-read-error-propagates', state: { path: 'src/module.py' }, calls: [
    { name: 'check', args: { path: 'src/module.py' }, result: { diagnostics: [{ path: 'src/error.py', line: 5, severity: 'error', message: 'error' }], counts: { error: 1 } } },
    { name: 'readFile', args: { path: 'src/error.py', range: [3, 7] }, error: 'EIO: diagnostic read failed' },
  ], expectedError: 'EIO: diagnostic read failed' },
);

/** Fixed missing-file/search sequence; the expected record is explicit at each callsite. */
function searchCase(id: string, result: unknown, expected: unknown): Case {
  return { id, state: { path: 'old/item.py', term: 'needle' }, calls: [
    { name: 'readFile', args: { path: 'old/item.py', range: [1, 80] }, error: 'ENOENT: absent' },
    { name: 'findFiles', args: { pattern: 'item.py', path: '.' }, result },
  ], expected };
}
located.cases.push(
  searchCase('absent-relocation', { files: [] }, { status: 'unresolved', ...locatedEmpty, reason: 'absent' }),
  searchCase('mismatched-filename', { files: ['safe/other.py'] }, { status: 'unsafe-location', ...locatedEmpty }),
  searchCase('truncated-empty-candidates', { files: [], truncated: 'unknown tail' },
    { status: 'unresolved', ...locatedEmpty, reason: 'incomplete', truncated: true }),
  searchCase('truncated-multiple-candidates', { files: ['a/item.py', 'b/item.py'], truncated: 'unknown tail' },
    { status: 'unresolved', ...locatedEmpty, reason: 'incomplete', truncated: true }),
);
for (const [name, path] of unsafePaths.filter(([, path]) => typeof path === 'string')) {
  located.cases.push(searchCase(`located-path-${name}`, { files: [path] }, { status: 'unsafe-location', ...locatedEmpty }));
}
for (const [name, term] of [['nonstring', 7], ['null', null], ['overlong', 'x'.repeat(81)]] as const) {
  located.cases.push({ id: `term-${name}`, state: { path: 'src/module.py', term }, calls: [], expected: { status: 'unsafe-input', ...locatedEmpty } });
}
for (const [id, path, term, text, lines, truncated] of [
  ['empty-read', 'src/item.py', 'needle', '', [], false],
  ['no-literal-match', 'src/item.py', 'Needle', '1 needle\n2 NEEDLE', [], false],
  ['exactly-three-matches', 'src/item.py', 'needle', '1 needle\n2 needle\n3 needle', ['1 needle', '2 needle', '3 needle'], false],
  ['truncation-marker-excluded', 'src/item.py', 'truncated', '1 truncated evidence\n[truncated at line 80 of 120]', ['1 truncated evidence'], true],
  ['embedded-marker-is-source', 'src/item.py', 'needle', '1 needle [truncated at line 80 of 120]', ['1 needle [truncated at line 80 of 120]'], false],
  ['maximum-term', 'src/item.py', 'x'.repeat(80), '1 ' + 'x'.repeat(80), ['1 ' + 'x'.repeat(80)], false],
  ['maximum-input-path', maxPath, 'needle', '1 needle', ['1 needle'], false],
] as const) {
  located.cases.push({ id, state: { path, term }, calls: [{ name: 'readFile', args: { path, range: [1, 80] }, result: text }],
    expected: { status: 'read', path, reason: null, lines: [...lines], omittedVisibleMatches: 0, truncated } });
}
for (const error of ['EACCES: not permitted', 'NOTENOENT: not the standalone error', 'ENOENTsuffix: not the standalone error']) {
  located.cases.push({ id: `first-read-error-${error.split(':')[0]}`, state: { path: 'src/item.py', term: 'needle' },
    calls: [{ name: 'readFile', args: { path: 'src/item.py', range: [1, 80] }, error }], expectedError: error });
}
located.cases.push(
  { id: 'search-error-propagates', state: { path: 'old/item.py', term: 'needle' }, calls: [
    { name: 'readFile', args: { path: 'old/item.py', range: [1, 80] }, error: 'ENOENT: absent' },
    { name: 'findFiles', args: { pattern: 'item.py', path: '.' }, error: 'EIO: search failed' },
  ], expectedError: 'EIO: search failed' },
  { id: 'second-read-error-propagates-without-retry', state: { path: 'old/item.py', term: 'needle' }, calls: [
    { name: 'readFile', args: { path: 'old/item.py', range: [1, 80] }, error: 'ENOENT: absent' },
    { name: 'findFiles', args: { pattern: 'item.py', path: '.' }, result: { files: ['new/item.py'] } },
    { name: 'readFile', args: { path: 'new/item.py', range: [1, 80] }, error: 'ENOENT: relocated file disappeared' },
  ], expectedError: 'ENOENT: relocated file disappeared' },
);

for (const path of ['space dir/é/.hidden-file_1.py']) {
  diagnostic.cases.push({ id: 'safe-nonascii-directory', state: { path },
    calls: [{ name: 'check', args: { path }, result: { diagnostics: [], counts: {} } }],
    expected: { status: 'clean', ...diagnosticEmpty, errorCount: 0 } });
  located.cases.push({ id: 'safe-nonascii-directory', state: { path, term: 'needle' },
    calls: [{ name: 'readFile', args: { path, range: [1, 80] }, result: '1 needle' }],
    expected: { status: 'read', path, reason: null, lines: ['1 needle'], omittedVisibleMatches: 0, truncated: false } });
}
