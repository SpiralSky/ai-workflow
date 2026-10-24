"""Newline-delimited JSON-RPC loop: `{id, method, params}` -> `{id, result | error: {message}}`.

Requests are served one at a time, in arrival order. The workspace root is argv[1] (default: cwd).
"""
import json
import os
import sys
import time
import traceback

from . import check, nav


def ping(root, params):
    """Liveness probe; `sleep` (seconds) is for tests."""
    time.sleep(float(params.get("sleep", 0)))
    return {"pong": True, "pid": os.getpid()}


def handlers():
    table = {"ping": ping}
    table.update(nav.METHODS)
    table.update(check.METHODS)
    return table


def main():
    root = os.path.realpath(sys.argv[1] if len(sys.argv) > 1 else os.getcwd())
    os.chdir(root)
    table = handlers()
    out = sys.stdout
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            fn = table.get(req.get("method"))
            if fn is None:
                raise ValueError("unknown method: %s" % req.get("method"))
            resp = {"id": rid, "result": fn(root, req.get("params") or {})}
        except Exception as e:  # tool errors travel as messages
            if os.environ.get("AIW_SIDECAR_DEBUG"):
                traceback.print_exc(file=sys.stderr)
            resp = {"id": rid, "error": {"message": str(e) or type(e).__name__}}
        out.write(json.dumps(resp) + "\n")
        out.flush()
