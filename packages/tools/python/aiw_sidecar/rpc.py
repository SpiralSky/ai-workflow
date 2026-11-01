"""Newline-delimited JSON-RPC loop: `{id, method, params}` -> `{id, result | error: {message}}`.

Requests are served one at a time, in arrival order. The workspace root is argv[1] (default: cwd).
A reader thread takes requests off stdin so that a `$cancel` notification (`params.id`) can reach
a request that is already running: exec tools watch `execution.CANCEL` and kill their child. A
request cancelled before it started is dropped. Cancelled requests get no reply (the client
already rejected them).
"""
import json
import os
import queue
import signal
import sys
import threading
import time
import traceback

from . import check, execution, graph, nav, refactor, testing


def ping(root, params):
    """Liveness probe; `sleep` (seconds) is for tests."""
    time.sleep(float(params.get("sleep", 0)))
    return {"pong": True, "pid": os.getpid()}


def handlers():
    table = {"ping": ping}
    table.update(nav.METHODS)
    table.update(graph.METHODS)
    table.update(refactor.METHODS)
    table.update(check.METHODS)
    table.update(testing.METHODS)
    return table


def main():
    root = os.path.realpath(sys.argv[1] if len(sys.argv) > 1 else os.getcwd())
    os.chdir(root)
    table = handlers()
    out = sys.stdout
    inbox = queue.Queue()
    lock = threading.Lock()
    state = {"current": None, "cancelled": set()}

    def shutdown(*_args):
        """Stop accepting work and cancel exec children before the sidecar exits."""
        execution.SHUTDOWN.set()
        execution.CANCEL.set()
        inbox.put(None)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    def reader():
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except ValueError:
                req = {"id": None, "method": None, "bad": True}
            if req.get("method") == "$cancel":
                cid = (req.get("params") or {}).get("id")
                with lock:
                    state["cancelled"].add(cid)
                    if state["current"] == cid:
                        execution.CANCEL.set()
                continue
            inbox.put(req)
        shutdown()

    threading.Thread(target=reader, daemon=True).start()
    while True:
        req = inbox.get()
        if req is None or execution.SHUTDOWN.is_set():
            return
        rid = req.get("id")
        with lock:
            if rid in state["cancelled"]:
                state["cancelled"].discard(rid)
                continue
            state["current"] = rid
            execution.CANCEL.clear()
        try:
            fn = table.get(req.get("method"))
            if fn is None:
                raise ValueError("unknown method: %s" % req.get("method"))
            resp = {"id": rid, "result": fn(root, req.get("params") or {})}
        except Exception as e:  # tool errors travel as messages
            if os.environ.get("AIW_SIDECAR_DEBUG"):
                traceback.print_exc(file=sys.stderr)
            resp = {"id": rid, "error": {"message": str(e) or type(e).__name__}}
        with lock:
            state["current"] = None
            state["cancelled"].discard(rid)
        if execution.SHUTDOWN.is_set():
            return
        out.write(json.dumps(resp) + "\n")
        out.flush()
