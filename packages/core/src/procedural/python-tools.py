"""Bounded offline Python procedure tools; task arguments are JSON, never shell commands."""
import ast
import hashlib
import io
import json
import keyword
import os
from pathlib import Path
import subprocess
import sys
import tokenize

ROOT = Path(sys.argv[2]).resolve(strict=True)


def files(paths):
    """Resolve explicit paths without following links outside the workspace."""
    found = set()
    for relative in paths:
        value = Path(relative)
        if value.is_absolute() or ".." in value.parts:
            raise ValueError("unsafe relative path")
        candidate = ROOT / value
        for parent in [candidate, *candidate.parents]:
            if parent == ROOT:
                break
            if parent.is_symlink():
                raise ValueError("symbolic links are unsupported")
        candidate.resolve(strict=True).relative_to(ROOT)
        entries = [candidate] if candidate.is_file() else candidate.rglob("*")
        for entry in entries:
            if entry.is_symlink():
                raise ValueError("symbolic links are unsupported")
            if entry.is_file() and entry.suffix == ".py":
                found.add(entry)
    if len(found) > 256:
        raise ValueError("file count bound")
    return sorted(found)


def scan(paths, symbol):
    """Inspect tokens and definitions while retaining exact source digests for stale checks."""
    result = []
    for file in files(paths):
        text = file.read_text()
        if len(text.encode()) > 262144:
            raise ValueError("source size bound")
        tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
        count = sum(t.type == tokenize.NAME and t.string == symbol for t in tokens)
        if count:
            tree = ast.parse(text)
            definitions = sum(isinstance(n, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == symbol for n in ast.walk(tree))
            result.append({"path": str(file.relative_to(ROOT)), "sha256": hashlib.sha256(text.encode()).hexdigest(), "references": count, "definitions": definitions})
    return result


def run(action, args):
    """Run a fixed deterministic action and return its outcome without a model."""
    if action == "check":
        results = []
        for directory in args["testDirs"]:
            files([directory])
            result = subprocess.run([sys.executable, "-B", "-m", "unittest", "discover", "-s", directory, "-p", "test_*.py", "-q"], cwd=ROOT, capture_output=True, text=True, timeout=20, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
            results.append({"directory": directory, "exitCode": result.returncode, "output": (result.stdout + result.stderr)[-8192:]})
            if result.returncode:
                return {"ok": False, "reason": "Python checks failed", "checks": results}
        return {"ok": True, "checks": results}
    old = args.get("symbol", args.get("oldName"))
    if not isinstance(old, str) or not old.isidentifier() or keyword.iskeyword(old):
        raise ValueError("invalid symbol")
    observations = scan(args["paths"], old)
    if action == "inspect":
        return {"ok": bool(observations), "reason": "symbol absent" if not observations else None, "files": observations}
    if action != "rename":
        raise ValueError("unknown action")
    new = args["newName"]
    if not isinstance(new, str) or not new.isidentifier() or keyword.iskeyword(new) or old == new:
        raise ValueError("invalid replacement")
    if observations != args["inspected"]["files"]:
        raise ValueError("source changed since inspection")
    if sum(item["definitions"] for item in observations) != 1:
        return {"ok": False, "reason": "expected one known definition"}
    if scan(args["paths"], new):
        return {"ok": False, "reason": "replacement identifier already exists"}
    replacements = []
    for item in observations:
        file = ROOT / item["path"]
        tokens = tokenize.generate_tokens(io.StringIO(file.read_text()).readline)
        text = tokenize.untokenize([t._replace(string=new) if t.type == tokenize.NAME and t.string == old else t for t in tokens])
        ast.parse(text)
        replacements.append((file, text))
    for file, text in replacements:
        file.write_text(text)
    return {"ok": True, "changed": [str(f.relative_to(ROOT)) for f, _ in replacements], "scope": "token rename, not general semantic binding resolution"}


try:
    print(json.dumps(run(sys.argv[1], json.loads(sys.stdin.read(1048576)))))
except Exception as error:
    print(json.dumps({"ok": False, "reason": str(error)}))
