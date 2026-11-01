"""Child-process execution shared by the `test` group (runTests, runSnippet, later coverage/traceCalls/stressRun).

Tool code that runs workspace code never runs it in the sidecar process (tool-catalog A-32): it
starts a child interpreter (`child.py`) with the workspace as cwd and on sys.path, and reads back
a JSON result file. The child's stdout/stderr go to temp files outside the workspace and come back
capped. A cancellation from the RPC loop (`$cancel`) or a timeout kills the child's process group.
"""
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

from .common import SKIP_DIRS

# Set by the RPC loop when the request being served is cancelled (the client aborted).
CANCEL = threading.Event()
# Session termination is never cleared between queued requests.
SHUTDOWN = threading.Event()

CHILD_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "child.py")

# `-c` keeps sys.path[0] at the cwd (the workspace), so the sidecar package directory never shadows workspace modules.
BOOT = "import runpy, sys; runpy.run_path(sys.argv[1])['main'](*sys.argv[2:])"


def cap_text(data, limit):
    """Decoded text of `data` (bytes); over `limit` bytes keeps the head third and the tail two thirds with a cut marker."""
    if len(data) <= limit:
        return data.decode("utf-8", "replace")
    head, tail = limit // 3, limit - limit // 3
    cut = len(data) - head - tail
    return data[:head].decode("utf-8", "replace") + "\n[%d bytes cut]\n" % cut + data[-tail:].decode("utf-8", "replace")


def _read(path, limit):
    """Capped text of a file, without loading a huge one whole."""
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        if size <= 4 * limit:
            return cap_text(f.read(), limit)
        head, tail = limit // 3, limit - limit // 3
        a = f.read(head)
        f.seek(size - tail)
        b = f.read(tail)
    return a.decode("utf-8", "replace") + "\n[%d bytes cut]\n" % (size - head - tail) + b.decode("utf-8", "replace")


def _kill(proc):
    if getattr(proc, "_aiw_group_reaped", False):
        return
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    proc.wait()
    proc._aiw_group_reaped = True


def run_child(root, kind, request, timeout, out_cap=8000, err_cap=None):
    """Runs `child.main(kind, request)` in a fresh interpreter and returns what came back.

    The request gets `root` and `skip` (directory names to ignore) added. The captured stdout/stderr are capped to `out_cap`/`err_cap` bytes. Returns
    `{status: "ok" | "timeout", code, stdout, stderr, result}`; `result` is the child's JSON
    result or None when it died before writing one (crash, kill, timeout).

    Raises ValueError("aborted") when the RPC loop cancels the request; the child is killed first.
    """
    proc = None
    tmp = tempfile.mkdtemp(prefix="aiw-child-")
    try:
        req_f, res_f = os.path.join(tmp, "req.json"), os.path.join(tmp, "res.json")
        out_f, err_f = os.path.join(tmp, "out"), os.path.join(tmp, "err")
        with open(req_f, "w", encoding="utf-8") as f:
            json.dump({**request, "root": root, "skip": sorted(SKIP_DIRS)}, f)
        env = dict(os.environ, PYTHONPATH=root, PYTHONUNBUFFERED="1", PYTHONDONTWRITEBYTECODE="1")
        with open(out_f, "wb") as out, open(err_f, "wb") as err:
            proc = subprocess.Popen([sys.executable, "-c", BOOT, CHILD_FILE, kind, req_f, res_f], cwd=root, env=env,
                                    stdin=subprocess.DEVNULL, stdout=out, stderr=err, start_new_session=True)
            deadline = time.monotonic() + timeout
            status = "ok"
            while proc.poll() is None:
                if CANCEL.is_set() or SHUTDOWN.is_set():
                    _kill(proc)
                    raise ValueError("aborted")
                if time.monotonic() >= deadline:
                    status = "timeout"
                    _kill(proc)
                    break
                time.sleep(0.02)
            else:
                # the leader exited; reap any stragglers it left in the group
                _kill(proc)
        result = None
        if status == "ok" and os.path.exists(res_f):
            with open(res_f, encoding="utf-8") as f:
                result = json.load(f)
        return {"status": status, "code": proc.returncode, "stdout": _read(out_f, out_cap), "stderr": _read(err_f, err_cap or out_cap), "result": result}
    finally:
        if proc is not None:
            _kill(proc)
        shutil.rmtree(tmp, ignore_errors=True)


def timeout_of(params, default, maximum):
    """`timeoutMs` argument in seconds, clamped to (0, maximum]."""
    ms = params.get("timeoutMs")
    if ms is None:
        return default
    if not isinstance(ms, (int, float)) or ms <= 0:
        raise ValueError("timeoutMs must be a positive number")
    return min(ms / 1000.0, maximum)
