"""Runs inside the child interpreter (started by `execution.run_child` via `runpy`); keep it self-contained.

`main(kind, request_file, result_file)` dispatches on `kind`; new exec tools add an entry to KINDS.
The result is written as JSON to `result_file` so the code's own prints never mix with it.
"""
import ast
import json
import os
import re
import sys
import threading
import traceback
import unittest

MESSAGE_CAP = 300
EXCERPT_CAP = 600
EXCERPT_LINES = 12


def _rel(root, path):
    """Workspace-relative `/` path of a file, or None outside the workspace or in skipped directories."""
    if not os.path.isabs(path):  # <frozen ...>, <string>
        return None
    try:
        r = os.path.relpath(os.path.realpath(path), root)
    except ValueError:
        return None
    if r.startswith(".."):
        return None
    return r.replace(os.sep, "/")


def _in_workspace(req, path):
    r = _rel(req["root"], path)
    return r if r and not any(p in req["skip"] for p in r.split("/")) else None


def _location(req, tb):
    """`{path, line}` of the deepest traceback frame inside the workspace, or None."""
    loc = None
    for fs in traceback.extract_tb(tb):
        r = _in_workspace(req, fs.filename)
        if r:
            loc = {"path": r, "line": fs.lineno}
    return loc


def _message(exc_type, value):
    text = "%s: %s" % (exc_type.__name__, value) if str(value) else exc_type.__name__
    return text if len(text) <= MESSAGE_CAP else text[:MESSAGE_CAP] + "..."


def _excerpt(req, text):
    """Short tail of a formatted traceback, with the workspace prefix removed."""
    text = text.replace(req["root"] + os.sep, "")
    lines = text.rstrip().splitlines()
    out = "\n".join(lines[-EXCERPT_LINES:])
    return out if len(out) <= EXCERPT_CAP else "..." + out[-EXCERPT_CAP:]


class Collector(unittest.TestResult):
    """Records failures and errors with the exception info the stock result drops."""

    def __init__(self, req):
        super().__init__()
        self.req = req
        self.entries = []
        self.skipped_n = 0

    def _add(self, test, kind, err, text):
        case = getattr(test, "test_case", test)
        if type(case) is unittest.loader._FailedTest:  # the "exception" is a formatted import traceback
            self._add_load_failure(case, str(err[1]))
            return
        msg = _message(err[0], err[1])
        sub = getattr(test, "params", None) if test is not case else None
        if sub is not None:
            msg = "[subtest %s] %s" % (test._subDescription(), msg)
        self.entries.append({"test": case, "kind": kind, "message": msg, "location": _location(self.req, err[2]), "excerpt": _excerpt(self.req, text)})

    def _add_load_failure(self, case, text):
        """A test module that failed to import: last traceback line as the message, deepest workspace frame as the location."""
        loc = None
        for m in re.finditer(r'File "([^"]+)", line (\d+)', text):
            r = _in_workspace(self.req, m.group(1))
            if r:
                loc = {"path": r, "line": int(m.group(2))}
        lines = [x for x in text.splitlines() if x.strip()]
        msg = lines[-1] if lines else "import error"
        self.entries.append({"test": case, "kind": "error", "message": msg[:MESSAGE_CAP], "location": loc, "excerpt": _excerpt(self.req, text)})

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._add(test, "failure", err, self.failures[-1][1])

    def addError(self, test, err):
        super().addError(test, err)
        self._add(test, "error", err, self.errors[-1][1])

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err is not None:
            kind, bucket = ("failure", self.failures) if issubclass(err[0], test.failureException) else ("error", self.errors)
            self._add(subtest, kind, err, bucket[-1][1])

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.skipped_n += 1

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self.entries.append({"test": test, "kind": "failure", "message": "unexpected success", "location": None, "excerpt": ""})


def _test_id(req, test, fallback):
    """`path#Class.method` of a test case; `fallback` for tests that failed to load."""
    cls = type(test)
    if cls is unittest.loader._FailedTest:
        return fallback
    mod = sys.modules.get(cls.__module__)
    path = _in_workspace(req, getattr(mod, "__file__", None) or "")
    return "%s#%s.%s" % (path or cls.__module__, cls.__qualname__, test._testMethodName)


def _flatten(suite):
    for t in suite:
        if isinstance(t, unittest.TestSuite):
            yield from _flatten(t)
        else:
            yield t


def run_tests(req):
    """Loads each unit (`{name, id}`: dotted unittest name and the id to report if it fails to load) and runs them in one result."""
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    owner = {}  # test case -> id to report if it is a load failure
    for u in req["units"]:
        whole_module = "#" not in u["id"]
        for t in _flatten(loader.loadTestsFromName(u["name"])):
            # a module's tests are those of classes defined in it, not of imported bases (as listTests)
            if whole_module and type(t) is not unittest.loader._FailedTest and type(t).__module__ != u["name"]:
                continue
            owner[t] = u["id"]
            suite.addTest(t)
    res = Collector(req)
    suite.run(res)
    failed = []
    for e in res.entries:
        failed.append({"id": _test_id(req, e["test"], owner.get(e["test"], "?")), "kind": e["kind"], "message": e["message"],
                       "location": e["location"], "excerpt": e["excerpt"]})
    bad = {f["id"] for f in failed}
    return {"passed": max(res.testsRun - len(bad) - res.skipped_n, 0), "skipped": res.skipped_n, "failed": failed}


def run_snippet(req):
    """Runs `code` in `__main__`-like globals; returns the repr of a trailing expression or the exception with its traceback."""
    code = req["code"]
    glb = {"__name__": "__main__", "__builtins__": __builtins__}
    out = {}
    try:
        tree = ast.parse(code, "<snippet>")
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body.pop().value)
        sys.argv = ["<snippet>"]
        exec(compile(tree, "<snippet>", "exec"), glb)
        if last is not None:
            val = eval(compile(last, "<snippet>", "eval"), glb)
            if val is not None:
                out["value"] = repr(val)
    except BaseException as e:  # the snippet's failure is the result, not ours
        tb = e.__traceback__
        while tb is not None and tb.tb_frame.f_code.co_filename != "<snippet>":
            tb = tb.tb_next
        text = "".join(traceback.format_exception(type(e), e, tb)) if tb else "".join(traceback.format_exception_only(type(e), e))
        loc = None
        for fs in traceback.extract_tb(tb):
            r = "<snippet>" if fs.filename == "<snippet>" else _in_workspace(req, fs.filename)
            if r:
                loc = {"path": r, "line": fs.lineno}
        out["exception"] = {"type": type(e).__name__, "message": str(e), "location": loc, "traceback": text.replace(req["root"] + os.sep, "")}
    return out


# ---- sys.monitoring (3.12): coverage and call tracing --------------------------------------

def _monitoring(tool_id, events, callbacks):
    """Claims a monitoring tool id, registers `callbacks` ({event: fn}) and enables `events`; returns a stop function."""
    mon = sys.monitoring
    mon.use_tool_id(tool_id, "aiw")
    for ev, fn in callbacks.items():
        mon.register_callback(tool_id, ev, fn)

    def stop():
        mon.set_events(tool_id, 0)
        for ev in callbacks:
            mon.register_callback(tool_id, ev, None)
        mon.free_tool_id(tool_id)

    mon.set_events(tool_id, events)
    return stop


def run_coverage(req):
    """Runs the tests under LINE monitoring and returns the executed line numbers of `file`, plus the test summary."""
    mon = sys.monitoring
    target = os.path.realpath(req["file"])
    covered = set()
    is_target = {}

    def on_line(code, line):
        fn = code.co_filename
        hit = is_target.get(fn)
        if hit is None:
            hit = is_target[fn] = os.path.realpath(fn) == target
        if hit:
            covered.add(line)
        return mon.DISABLE  # each location is only needed once

    stop = _monitoring(mon.COVERAGE_ID, mon.events.LINE, {mon.events.LINE: on_line})
    try:
        tests = run_tests(req)
    finally:
        stop()
    return {"tests": {"passed": tests["passed"], "skipped": tests["skipped"], "failed": len(tests["failed"])}, "covered": sorted(covered)}


def _short(v, cap=80):
    """Capped repr that never raises."""
    try:
        t = repr(v)
    except BaseException as e:
        t = "<repr failed: %s>" % type(e).__name__
    return t if len(t) <= cap else t[:cap] + "..."


def run_trace(req):
    """Runs a snippet or tests while recording calls to the target functions; events are ordered by call start."""
    mon = sys.monitoring
    targets = {(os.path.realpath(t["file"]), t["qualname"]): t["symbol"] for t in req["targets"]}
    cap = req["cap"]
    lock = threading.Lock()
    local = threading.local()
    state = {"seq": 0, "total": 0}
    events, pending, decided = [], {}, {}

    def symbol_of(code):
        s = decided.get(code, False)
        if s is False:
            s = decided[code] = targets.get((os.path.realpath(code.co_filename), code.co_qualname))
        return s

    def who():
        t = threading.current_thread()
        info = {"thread": {"id": t.ident, "name": t.name}}
        aio = sys.modules.get("asyncio")
        if aio is not None:
            try:
                task = aio.current_task()
            except RuntimeError:
                task = None
            if task is not None:
                info["task"] = task.get_name()
        return info

    def on_start(code, offset):
        sym = symbol_of(code)
        if sym is None:
            return mon.DISABLE
        if getattr(local, "busy", False):
            return None
        local.busy = True
        try:
            frame = sys._getframe(1)
            n = code.co_argcount + code.co_kwonlyargcount + bool(code.co_flags & 4) + bool(code.co_flags & 8)
            args = {name: _short(frame.f_locals.get(name)) for name in code.co_varnames[:n]}
            ev = {"symbol": sym, "args": args, **who()}
            with lock:
                state["total"] += 1
                if len(events) >= cap:
                    return None
                state["seq"] += 1
                ev = {"seq": state["seq"], **ev}
                events.append(ev)
                pending[id(frame)] = ev
        finally:
            local.busy = False

    def on_return(code, offset, value):
        if symbol_of(code) is None:
            return mon.DISABLE
        if getattr(local, "busy", False):
            return None
        local.busy = True
        try:
            ev = pending.pop(id(sys._getframe(1)), None)
            if ev is not None:
                ev["returned"] = _short(value)
        finally:
            local.busy = False

    def on_unwind(code, offset, exc):
        if symbol_of(code) is None:
            return None  # PY_UNWIND cannot be disabled
        if getattr(local, "busy", False):
            return None
        local.busy = True
        try:
            ev = pending.pop(id(sys._getframe(1)), None)
            if ev is not None:
                ev["raised"] = _short("%s: %s" % (type(exc).__name__, exc), 120)
        finally:
            local.busy = False

    E = mon.events
    stop = _monitoring(mon.DEBUGGER_ID, E.PY_START | E.PY_RETURN | E.PY_UNWIND, {E.PY_START: on_start, E.PY_RETURN: on_return, E.PY_UNWIND: on_unwind})
    run = {}
    try:
        if "code" in req:
            run = run_snippet(req)
        else:
            t = run_tests(req)
            run = {"tests": {"passed": t["passed"], "skipped": t["skipped"], "failed": [f["id"] for f in t["failed"]]}}
    finally:
        stop()
    return {"calls": events, "total": state["total"], "run": run}


KINDS = {"tests": run_tests, "snippet": run_snippet, "coverage": run_coverage, "trace": run_trace}


def main(kind, req_file, res_file):
    with open(req_file, encoding="utf-8") as f:
        req = json.load(f)
    if req["root"] not in sys.path:
        sys.path.insert(0, req["root"])
    res = KINDS[kind](req)
    with open(res_file, "w", encoding="utf-8") as f:
        json.dump(res, f)
