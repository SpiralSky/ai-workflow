"""Static checks: pyright (types), ruff (lint) and the workspace formatter."""
import difflib
import json
import os
import subprocess
import sys
import tomllib

from .common import SKIP_DIRS, is_python, rel, resolve, unsupported

MAX_DIAGS = 500
TIMEOUT = 180


def _bin(name):
    """Tool binary from the venv the sidecar runs in."""
    return os.path.join(os.path.dirname(sys.executable), name)


def _run(argv, root):
    try:
        return subprocess.run(argv, cwd=root, capture_output=True, text=True, timeout=TIMEOUT)
    except FileNotFoundError:
        raise ValueError("%s not found in the tool venv" % os.path.basename(argv[0]))
    except subprocess.TimeoutExpired:
        raise ValueError("%s timed out after %ds" % (os.path.basename(argv[0]), TIMEOUT))


def _target(root, path):
    """(arg for the checkers, abs path); a file must be Python."""
    if not path:
        return ".", root
    abs_path = resolve(root, path)
    if not os.path.exists(abs_path):
        raise ValueError("no such file or directory: %s" % path)
    if os.path.isfile(abs_path) and not is_python(path):
        unsupported(path)
    return rel(root, abs_path) or ".", abs_path


def _pyright(root, arg):
    argv = [_bin("pyright"), "--outputjson", arg]
    if "AIW_OFFLINE_CHECKS" in os.environ:
        from .offline_check import pyright_argv
        argv = pyright_argv(arg)
    r = _run(argv, root)
    try:
        data = json.loads(r.stdout)
    except ValueError:
        raise ValueError("pyright failed: %s" % (r.stderr or r.stdout).strip()[-300:])
    out = []
    for d in data.get("generalDiagnostics", []):
        start = d.get("range", {}).get("start", {})
        out.append({"path": rel(root, d["file"]) or d["file"], "line": start.get("line", 0) + 1, "col": start.get("character", 0) + 1,
                    "severity": {"information": "info"}.get(d["severity"], d["severity"]), "code": d.get("rule"),
                    "message": d["message"], "source": "pyright"})
    return out


def _ruff(root, arg):
    r = _run([_bin("ruff"), "check", "--output-format", "json", "--no-cache", arg], root)
    try:
        data = json.loads(r.stdout or "[]")
    except ValueError:
        raise ValueError("ruff failed: %s" % (r.stderr or r.stdout).strip()[-300:])
    out = []
    for d in data:
        loc = d.get("location") or {}
        out.append({"path": rel(root, d["filename"]) or d["filename"], "line": loc.get("row", 1), "col": loc.get("column", 1),
                    "severity": "warning" if d.get("code") else "error", "code": d.get("code"),
                    "message": d["message"], "source": "ruff"})
    return out


def check(root, p):
    kinds = p.get("kinds") or ["types", "lint"]
    bad = [k for k in kinds if k not in ("types", "lint")]
    if bad:
        raise ValueError("unknown kind: %s" % bad[0])
    arg, _ = _target(root, p.get("path"))
    diags = []
    if "types" in kinds:
        diags += _pyright(root, arg)
    if "lint" in kinds:
        diags += _ruff(root, arg)
    diags.sort(key=lambda d: (d["path"], d["line"], d["col"], d["source"]))
    counts = {}
    for d in diags:
        counts[d["severity"]] = counts.get(d["severity"], 0) + 1
    res = {"diagnostics": diags[:MAX_DIAGS], "counts": counts}
    if len(diags) > MAX_DIAGS:
        res["truncated"] = "showing %d of %d; pass path or kinds to narrow" % (MAX_DIAGS, len(diags))
    return res


def _formatter(root):
    """Extra `ruff format` args when the workspace configures a formatter, else None."""
    for name in ("ruff.toml", ".ruff.toml"):
        f = os.path.join(root, name)
        if os.path.isfile(f):
            with open(f, "rb") as fh:
                if "format" in tomllib.load(fh):
                    return []
    f = os.path.join(root, "pyproject.toml")
    if os.path.isfile(f):
        with open(f, "rb") as fh:
            tool = tomllib.load(fh).get("tool", {})
        if "format" in tool.get("ruff", {}):
            return []
        if "black" in tool:  # black config: ruff format is black-compatible; carry over line length
            ll = tool["black"].get("line-length")
            return ["--line-length", str(ll)] if ll else []
    return None


def _py_files(abs_path):
    if os.path.isfile(abs_path):
        return [abs_path]
    out = []
    for d, dirs, files in os.walk(abs_path):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
        out += [os.path.join(d, f) for f in sorted(files) if is_python(f)]
    return out


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read().splitlines()


def format_(root, p):
    extra = _formatter(root)
    if extra is None:
        raise ValueError("no formatter configured")
    arg, abs_path = _target(root, p.get("path"))
    files = _py_files(abs_path)
    before = {f: _read(f) for f in files}
    r = _run([_bin("ruff"), "format", "--no-cache", *extra, arg], root)
    if r.returncode != 0:
        raise ValueError("ruff format failed: %s" % (r.stderr or r.stdout).strip()[-300:])
    changed = []
    for f in files:
        after = _read(f)
        if after != before[f]:
            added = removed = 0
            for op in difflib.ndiff(before[f], after):
                added += op.startswith("+ ")
                removed += op.startswith("- ")
            changed.append({"path": rel(root, f), "added": added, "removed": removed})
    return {"files": changed}


METHODS = {"check": check, "format": format_}
