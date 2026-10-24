"""The `test` group: runTests, listTests, runSnippet.

Workspace code runs only in a child interpreter (`execution.run_child`). `listTests` never runs
code: it reads test classes and methods from the syntax trees.
"""
import ast
import os

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


def run_tests(root, params):
    global _last_failed
    timeout = execution.timeout_of(params, TESTS_TIMEOUT, TESTS_TIMEOUT_MAX)
    units = _units(root, params)
    if not units:
        _last_failed = [] if params.get("failedOnly") else _last_failed
        return {"passed": 0, "skipped": 0, "failed": []}
    r = execution.run_child(root, "tests", {"units": units}, timeout, out_cap=600)
    if r["status"] == "timeout":
        raise ValueError("tests timed out after %gs" % timeout)
    if r["result"] is None:
        tail = (r["stderr"] or r["stdout"]).strip().splitlines()[-1:] or [""]
        raise ValueError("test process exited with code %s without a result: %s" % (r["code"], tail[0][:200]))
    res = r["result"]
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
        out["exception"] = res["exception"]
        out["exception"]["traceback"] = execution.cap_text(out["exception"]["traceback"].encode("utf-8"), 3000)
    return out


METHODS = {"runTests": run_tests, "listTests": list_tests, "runSnippet": run_snippet}
