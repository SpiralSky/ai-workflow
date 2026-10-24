"""The `test` group: runTests, listTests, runSnippet.

Workspace code runs only in a child interpreter (`execution.run_child`). `listTests` never runs
code: it reads test classes and methods from the syntax trees.
"""
import ast
import os
import time
from concurrent.futures import ThreadPoolExecutor

from . import execution, graph
from .common import SKIP_DIRS, is_python, rel, resolve, unsupported

MAX_FAILED = 200
TESTS_TIMEOUT = 120.0
TESTS_TIMEOUT_MAX = 600.0
SNIPPET_TIMEOUT = 30.0
SNIPPET_TIMEOUT_MAX = 300.0
STDOUT_CAP = 4000
STDERR_CAP = 2000
VALUE_CAP = 2000

# Ids of the tests that failed or errored in the previous runTests call (for `failedOnly`).
_last_failed = None


def _is_test_file(name):
    return name.endswith(".py") and (name.startswith("test") or name.endswith("_test.py")) and name[:-3].isidentifier()


def _test_files(root, start):
    """Workspace-relative paths of test files (`test*.py`, `*_test.py`) under `start` (a directory), in order.

    Directories that are hidden, skipped (`.venv`, `node_modules`...) or not importable names are not entered.
    """
    out = []
    for d, dirs, files in os.walk(start):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not x.startswith(".") and x.isidentifier())
        out += [rel(root, os.path.join(d, f)) for f in sorted(files) if _is_test_file(f)]
    return out


def _py_files(root):
    out = []
    for d, dirs, files in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not x.startswith("."))
        out += [rel(root, os.path.join(d, f)) for f in sorted(files) if f.endswith(".py")]
    return out


def _module(path):
    return path[:-3].replace("/", ".")


def _scope(root, path):
    """(abs path, is_file) of an existing workspace file or directory."""
    abs_path = resolve(root, path)
    if not os.path.exists(abs_path):
        raise ValueError("no such file or directory: %s" % path)
    if os.path.isfile(abs_path) and not is_python(path):
        unsupported(path)
    return abs_path, os.path.isfile(abs_path)


# ---- listTests -----------------------------------------------------------------------------

def _scan(root, path):
    """{class name: (base names, [method names], [test method names])} of the module-level classes of a file."""
    try:
        with open(os.path.join(root, path), encoding="utf-8") as f:
            tree = ast.parse(f.read())
    except (SyntaxError, ValueError, OSError):
        return {}
    out = {}
    for n in tree.body:
        if isinstance(n, ast.ClassDef):
            bases = [b.attr if isinstance(b, ast.Attribute) else b.id for b in n.bases if isinstance(b, (ast.Name, ast.Attribute))]
            tests = [m.name for m in n.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)) and m.name.startswith("test")]
            out[n.name] = (bases, tests)
    return out


def all_tests(root, start=None):
    """Sorted test ids (`path#Class.method`) found by scanning test files; classes derive from `*TestCase` directly or via workspace classes."""
    files = _test_files(root, start or root)
    own = {p: _scan(root, p) for p in files}
    # base classes may live in any workspace file (helpers, mixins): index every scanned class by name
    pool = {}
    for p in _py_files(root):
        for name, ent in (own.get(p) or _scan(root, p)).items():
            pool.setdefault(name, ent)

    def resolve_cls(name, seen=()):
        """(is TestCase subclass, inherited test method names) of a class name."""
        if name.endswith("TestCase"):
            return True, []
        if name in seen or name not in pool:
            return False, []
        bases, tests = pool[name]
        is_t, methods = False, list(tests)
        for b in bases:
            bt, bm = resolve_cls(b, seen + (name,))
            is_t = is_t or bt
            methods += bm
        return is_t, methods

    ids = []
    for p in files:
        for name in own[p]:
            is_t, methods = resolve_cls(name)
            if is_t:
                ids += ["%s#%s.%s" % (p, name, m) for m in sorted(set(methods))]
    return sorted(set(ids))


def list_tests(root, params):
    path, symbol = params.get("path"), params.get("symbol")
    start = None
    if path:
        abs_path, is_file = _scope(root, path)
        start = None if is_file else abs_path
    tests = all_tests(root, start)
    if path and start is None:
        tests = [t for t in tests if t.startswith(rel(root, resolve(root, path)) + "#")]
    if symbol:
        reached = graph.impact(root, {"symbol": symbol})["tests"]
        by_call = {t["symbol"] for t in reached if t["via"] == "call"}
        call_files = {s.split("#", 1)[0] for s in by_call}
        import_files = {t["path"] for t in reached if t["via"] == "import" and t["path"] not in call_files}
        # a call edge names the test method (or a helper it calls): keep real tests; import-only files contribute all their tests
        tests = [t for t in tests if t in by_call or t.split("#", 1)[0] in import_files]
    return {"tests": tests}


# ---- runTests ------------------------------------------------------------------------------

def _units(root, params):
    """The `{name, id}` units to load for the selection, and which selection it was."""
    target, failed_only = params.get("target"), params.get("failedOnly")
    if target and failed_only:
        raise ValueError("pass target or failedOnly, not both")
    if failed_only:
        if _last_failed is None:
            raise ValueError("no previous runTests call to take failures from")
        ids = _last_failed
    elif target and "#" in target:
        path = target.split("#", 1)[0]
        _scope(root, path)
        ids = [target]
    else:
        abs_path, is_file = _scope(root, target) if target else (root, False)
        ids = [rel(root, abs_path)] if is_file else _test_files(root, abs_path)
    units = []
    for i in ids:
        path, _, sym = i.partition("#")
        if not is_python(path):
            unsupported(path)
        units.append({"name": _module(path) + ("." + sym if sym else ""), "id": i})
    return units


def _result_of(r, what, timeout):
    """Result of a child run that must produce one.

    Raises ValueError on timeout or when the child died without a result.
    """
    if r["status"] == "timeout":
        raise ValueError("%s timed out after %gs" % (what, timeout))
    if r["result"] is None:
        tail = (r["stderr"] or r["stdout"]).strip().splitlines()[-1:] or [""]
        raise ValueError("%s process exited with code %s without a result: %s" % (what, r["code"], tail[0][:200]))
    return r["result"]


def run_tests(root, params):
    global _last_failed
    timeout = execution.timeout_of(params, TESTS_TIMEOUT, TESTS_TIMEOUT_MAX)
    units = _units(root, params)
    if not units:
        _last_failed = [] if params.get("failedOnly") else _last_failed
        return {"passed": 0, "skipped": 0, "failed": []}
    res = _result_of(execution.run_child(root, "tests", {"units": units}, timeout, out_cap=600), "tests", timeout)
    _last_failed = list(dict.fromkeys(f["id"] for f in res["failed"]))
    if len(res["failed"]) > MAX_FAILED:
        res["truncated"] = "showing %d of %d failures; use target to narrow" % (MAX_FAILED, len(res["failed"]))
        res["failed"] = res["failed"][:MAX_FAILED]
    return res


# ---- runSnippet ----------------------------------------------------------------------------

def run_snippet(root, params):
    code = params.get("code")
    if not isinstance(code, str) or not code.strip():
        raise ValueError("code must be a non-empty string")
    timeout = execution.timeout_of(params, SNIPPET_TIMEOUT, SNIPPET_TIMEOUT_MAX)
    r = execution.run_child(root, "snippet", {"code": code}, timeout, out_cap=STDOUT_CAP, err_cap=STDERR_CAP)
    out = {"stdout": r["stdout"], "stderr": r["stderr"]}
    if r["status"] == "timeout":
        out["timedOut"] = True
        return out
    res = r["result"]
    if res is None:
        out["exitCode"] = r["code"]  # the process died without reporting (os._exit, a signal)
        return out
    if "value" in res:
        out["value"] = execution.cap_text(res["value"].encode("utf-8"), VALUE_CAP)
    if "exception" in res:
        out["exception"] = _cap_exception(res["exception"])
    return out


def _cap_exception(exc):
    exc["traceback"] = execution.cap_text(exc["traceback"].encode("utf-8"), 3000)
    return exc


# ---- coverage ------------------------------------------------------------------------------

MAX_RANGES = 200
COVERAGE_TIMEOUT_MAX = 600.0
MAX_TRACE_SYMBOLS = 10
TRACE_CAP = 100
STRESS_MAX_RUNS = 200
STRESS_MAX_PARALLEL = 16
STRESS_MAX_DISTINCT = 5


def _parse(root, path):
    """(abs path, source, syntax tree) of a workspace Python file."""
    if not is_python(path):
        unsupported(path)
    abs_path = resolve(root, path)
    if not os.path.isfile(abs_path):
        raise ValueError("no such file: %s" % path)
    with open(abs_path, encoding="utf-8") as f:
        src = f.read()
    try:
        return abs_path, src, ast.parse(src)
    except SyntaxError:
        raise ValueError("syntax error in %s" % path)


def _find_def(tree, name):
    """(node, `co_qualname`) of `Class.method` / `func` / nested `a.b` in a module tree, or None."""
    body, qual = tree.body, ""
    node = None
    for part in name.split("."):
        node = next((n for n in body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.name == part), None)
        if node is None:
            return None
        qual = part if not qual else qual + (".<locals>." if qual_is_func else ".") + part
        qual_is_func = not isinstance(node, ast.ClassDef)
        body = node.body
    return node, qual


def _span(node):
    """First (including decorators) and last line of a definition."""
    return min([node.lineno] + [d.lineno for d in getattr(node, "decorator_list", [])]), node.end_lineno


def _executable_lines(src, path):
    """Lines that carry bytecode, from the code objects of the compiled file (nothing is run)."""
    lines = set()
    stack = [compile(src, path, "exec")]
    while stack:
        code = stack.pop()
        lines.update(ln for _, _, ln in code.co_lines() if ln)
        stack += [c for c in code.co_consts if hasattr(c, "co_lines")]
    return lines


def _ranges(lines):
    """Consecutive runs of an ordered list of line numbers as [start, end] pairs."""
    out = []
    for ln in lines:
        if out and out[-1][1] == ln - 1:
            out[-1][1] = ln
        else:
            out.append([ln, ln])
    return out


def coverage(root, params):
    target = params.get("target")
    if not isinstance(target, str) or not target:
        raise ValueError("target must be a file or path#Name")
    path, _, name = target.partition("#")
    abs_path, src, tree = _parse(root, path)
    lines = sorted(_executable_lines(src, path))
    if name:
        found = _find_def(tree, name)
        if found is None:
            raise ValueError("symbol not found: %s" % target)
        lo, hi = _span(found[0])
        lines = [ln for ln in lines if lo <= ln <= hi]
    timeout = execution.timeout_of(params, TESTS_TIMEOUT, COVERAGE_TIMEOUT_MAX)
    units = _units(root, {"target": params.get("tests")})
    res = _result_of(execution.run_child(root, "coverage", {"units": units, "file": abs_path}, timeout, out_cap=600), "coverage run", timeout)
    hit = set(res["covered"])
    missing = [ln for ln in lines if ln not in hit]
    out = {"path": rel(root, abs_path)}
    if name:
        out["symbol"] = target
    out.update({"covered": len(lines) - len(missing), "total": len(lines),
                "percent": round(100.0 * (len(lines) - len(missing)) / len(lines), 1) if lines else 100.0,
                "uncovered": _ranges(missing), "tests": res["tests"]})
    if len(out["uncovered"]) > MAX_RANGES:
        out["truncated"] = "showing %d of %d uncovered ranges; pass a symbol to narrow" % (MAX_RANGES, len(out["uncovered"]))
        out["uncovered"] = out["uncovered"][:MAX_RANGES]
    return out


# ---- traceCalls ----------------------------------------------------------------------------

def _run_source(root, params):
    """The child kind and request fields for a `snippet` or `test` argument (exactly one of them)."""
    snippet, test = params.get("snippet"), params.get("test")
    if bool(snippet) == bool(test):
        raise ValueError("pass exactly one of snippet or test")
    if snippet:
        if not isinstance(snippet, str):
            raise ValueError("snippet must be a string")
        return "snippet", {"code": snippet}
    return "tests", {"units": _units(root, {"target": test})}


def trace_calls(root, params):
    symbols = params.get("symbols")
    if not isinstance(symbols, list) or not symbols or not all(isinstance(x, str) for x in symbols):
        raise ValueError("symbols must be a non-empty list of path#Name")
    if len(symbols) > MAX_TRACE_SYMBOLS:
        raise ValueError("at most %d symbols" % MAX_TRACE_SYMBOLS)
    targets = []
    for sym in symbols:
        path, _, name = sym.partition("#")
        if not name:
            raise ValueError("symbol must be path#Name: %s" % sym)
        abs_path, _, tree = _parse(root, path)
        found = _find_def(tree, name)
        if found is None:
            raise ValueError("symbol not found: %s" % sym)
        node, qual = found
        if isinstance(node, ast.ClassDef):  # a class is traced through its constructor
            ctor = _find_def(tree, name + ".__init__")
            if ctor is None:
                raise ValueError("class has no __init__ to trace: %s" % sym)
            qual = ctor[1]
        targets.append({"file": abs_path, "qualname": qual, "symbol": sym})
    kind, req = _run_source(root, params)
    timeout = execution.timeout_of(params, TESTS_TIMEOUT, TESTS_TIMEOUT_MAX)
    res = _result_of(execution.run_child(root, "trace", {**req, "targets": targets, "cap": TRACE_CAP}, timeout, out_cap=600), "traceCalls", timeout)
    run = res["run"]
    if "exception" in run:
        run["exception"] = _cap_exception(run["exception"])
    out = {"calls": res["calls"], "total": res["total"], "run": run}
    if res["total"] > len(res["calls"]):
        out["truncated"] = "showing first %d of %d calls; trace fewer symbols or a narrower run" % (len(res["calls"]), res["total"])
    return out


# ---- stressRun -----------------------------------------------------------------------------

def _int_arg(params, key, default, maximum):
    v = params.get(key)
    if v is None:
        return default
    if not isinstance(v, int) or isinstance(v, bool) or v < 1:
        raise ValueError("%s must be a positive integer" % key)
    return min(v, maximum)


def _failures_of(r, kind):
    """Failure signatures of one finished run (empty when it passed): dicts with type, message, location, id?."""
    if r["status"] == "timeout":
        return [{"type": "Timeout", "message": "run did not finish in time", "location": None}]
    res = r["result"]
    if res is None:
        tail = (r["stderr"] or r["stdout"]).strip().splitlines()[-1:] or [""]
        return [{"type": "Crash", "message": "exit code %s: %s" % (r["code"], tail[0][:200]), "location": None}]
    if kind == "snippet":
        e = res.get("exception")
        return [{"type": e["type"], "message": e["message"][:300], "location": e["location"]}] if e else []
    return [{"type": f["message"].split(":", 1)[0], "message": f["message"], "location": f["location"], "id": f["id"]} for f in res["failed"]]


def stress_run(root, params):
    n = _int_arg(params, "n", 20, STRESS_MAX_RUNS)
    workers = min(_int_arg(params, "parallel", 4, STRESS_MAX_PARALLEL), n)
    overall = execution.timeout_of(params, 60.0, TESTS_TIMEOUT_MAX)
    per_run = execution.timeout_of({"timeoutMs": params.get("runTimeoutMs")}, 30.0, TESTS_TIMEOUT_MAX)
    kind, req = _run_source(root, params)
    deadline = time.monotonic() + overall
    done = [None] * n  # per run: list of failure signatures, or None when it did not complete

    def work(i):
        left = deadline - time.monotonic()
        if left <= 0:
            return
        limit = min(per_run, left)
        r = execution.run_child(root, kind, req, limit, out_cap=300)
        if r["status"] == "timeout" and limit < per_run:
            return  # cut short by the overall deadline, not a verdict
        done[i] = _failures_of(r, kind)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for f in [pool.submit(work, i) for i in range(n)]:
            f.result()  # an abort raises here
    finished = [d for d in done if d is not None]
    distinct = {}
    for i, sigs in enumerate(done):
        for sg in sigs or []:
            loc = sg["location"]
            key = (sg["type"], loc and loc["path"], loc and loc["line"], sg.get("id"))
            if key in distinct:
                distinct[key]["count"] += 1
            else:
                distinct[key] = {**sg, "count": 1, "firstRun": i + 1}
    failed_runs = sum(1 for d in finished if d)
    out = {"runs": len(finished), "failures": failed_runs,
           "failureRate": round(failed_runs / len(finished), 3) if finished else 0.0,
           "distinct": list(distinct.values())[:STRESS_MAX_DISTINCT]}
    if len(distinct) > STRESS_MAX_DISTINCT:
        out["truncated"] = "showing %d of %d distinct failures" % (STRESS_MAX_DISTINCT, len(distinct))
    if len(finished) < n:
        out["timedOut"] = True
    return out


METHODS = {"runTests": run_tests, "listTests": list_tests, "coverage": coverage, "runSnippet": run_snippet,
           "traceCalls": trace_calls, "stressRun": stress_run}
