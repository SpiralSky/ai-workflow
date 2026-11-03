"""Native-only, fail-closed launch of an already installed Pyright JS bundle.

This intentionally bypasses pyright-python's installer/version-selection wrapper.
It is a launcher adaptation, not a claim of identical process topology.
"""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys

PYRIGHT_VERSION = "1.1.414"
MODE = "native-offline-bundled-pyright-v1"
MAX_FILES = 10000
MAX_BUNDLE_BYTES = 134217728


def _read_file(path, limit, capture=False):
    """Read/hash one bounded regular-file snapshot without blocking on special files."""
    path = Path(path)
    if not path.is_absolute() or path.resolve(strict=True) != path:
        raise ValueError("offline check runtime: noncanonical file")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > limit:
            raise ValueError("offline check runtime: unsupported file")
        digest = hashlib.sha256()
        count = 0
        chunks = [] if capture else None
        while True:
            chunk = os.read(fd, min(1048576, limit + 1 - count))
            if not chunk:
                break
            count += len(chunk)
            if count > limit:
                raise ValueError("offline check runtime: file grew beyond bound")
            digest.update(chunk)
            if capture:
                chunks.append(chunk)
        identity = lambda st: (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns, st.st_mode, st.st_nlink)
        if count != before.st_size or identity(before) != identity(os.fstat(fd)) or identity(before) != identity(path.lstat()) or path.resolve(strict=True) != path:
            raise ValueError("offline check runtime: file changed while hashing")
        return {"sha256": digest.hexdigest(), "bytes": before.st_size, "mode": stat.S_IMODE(before.st_mode)}, b"".join(chunks) if capture else None
    finally:
        os.close(fd)


def _file_hash(path, limit=268435456):
    """Return the identity of a bounded regular-file snapshot."""
    return _read_file(path, limit)[0]


def _json_file(path, limit):
    """Parse the same bounded/no-follow bytes that were actually validated."""
    return json.loads(_read_file(path, limit, capture=True)[1])


def _bundle_hash(root):
    """Bind the whole JS/stub bundle with finite file, byte, directory and depth bounds."""
    root = Path(root)
    if not root.is_dir() or root.resolve(strict=True) != root:
        raise ValueError("offline check runtime: missing/noncanonical bundle")
    rows = []
    total = 0
    directories = 0

    def walk(directory, depth):
        nonlocal total, directories
        directories += 1
        if directories > 10000 or depth > 32:
            raise ValueError("offline check runtime: bundle directory/depth bound")
        entries = []
        with os.scandir(directory) as scan:
            for entry in scan:
                entries.append(entry)
                if len(entries) + len(rows) + directories > 20000:
                    raise ValueError("offline check runtime: bundle entry bound")
        for entry in sorted(entries, key=lambda e: e.name):
            child = Path(entry.path)
            if entry.is_symlink() or child.resolve(strict=True) != child:
                raise ValueError("offline check runtime: noncanonical bundle entry")
            if entry.is_dir(follow_symlinks=False):
                walk(child, depth + 1)
            else:
                identity = _file_hash(child, 67108864)
                total += identity["bytes"]
                rows.append([child.relative_to(root).as_posix(), identity])
                if len(rows) > MAX_FILES or total > MAX_BUNDLE_BYTES:
                    raise ValueError("offline check runtime: oversized bundle")
    walk(root, 0)
    if not rows:
        raise ValueError("offline check runtime: empty bundle")
    rows.sort(key=lambda row: row[0])
    encoded = json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()
    return {"sha256": hashlib.sha256(encoded).hexdigest(), "files": len(rows), "bytes": total}


def _runtime_lock():
    """Read the reviewed environment-specific lock; never regenerate it at runtime."""
    path = Path(__file__).parent / "offline_check_runtime.json"
    lock = _json_file(path, 16384)
    if lock.get("mode") != MODE or lock.get("pyright", {}).get("version") != PYRIGHT_VERSION:
        raise ValueError("offline check runtime: invalid pinned runtime lock")
    return lock


def inspect_runtime(node_path):
    """Read and validate the installed closure; no installer or network code is used."""
    node = Path(node_path)
    node_identity = _file_hash(node)
    if node.name != "node" or not os.access(node, os.X_OK) or shutil.which("node") != str(node):
        raise ValueError("offline check runtime: bound Node is not the selected executable")
    distribution = importlib.metadata.distribution("pyright")
    package = Path(distribution.locate_file("pyright"))
    venv = Path(sys.prefix)
    if venv.resolve(strict=True) != venv or not package.is_relative_to(venv):
        raise ValueError("offline check runtime: pyright is outside the explicit venv")
    bundle = package / "dist"
    metadata = _json_file(bundle / "package.json", 1048576)
    if distribution.version != PYRIGHT_VERSION or metadata.get("version") != PYRIGHT_VERSION:
        raise ValueError("offline check runtime: pyright version mismatch")
    for relative in ("index.js", "dist/pyright.js", "dist/pyright-internal.js", "dist/vendor.js"):
        _file_hash(bundle / relative, 67108864)
    if not (bundle / "dist/typeshed-fallback").is_dir():
        raise ValueError("offline check runtime: missing fallback typeshed")
    source = Path(__file__).parent
    sources = {name: _file_hash(source / name, 1048576) for name in ("offline_check.py", "check.py", "offline_check_runtime.json")}
    sources["../requirements.txt"] = _file_hash(source.parent / "requirements.txt", 1048576)
    bundle_identity = _bundle_hash(bundle)
    lock = _runtime_lock()
    if node_identity != {key: lock["node"][key] for key in ("sha256", "bytes", "mode")} or bundle_identity != lock["pyright"]["bundle"]:
        raise ValueError("offline check runtime: installed Node/bundle differs from pinned lock")
    return {"mode": MODE, "venv": str(venv), "node": {"path": str(node), **node_identity},
            "pyright": {"version": PYRIGHT_VERSION, "entry": str(bundle / "index.js"), "bundle": bundle_identity},
            "sourceRoot": str(source), "sources": sources}


def validate_runtime(expected):
    """Reject missing or changed bindings before executing the checker."""
    if not isinstance(expected, dict) or expected.get("mode") != MODE:
        raise ValueError("offline check runtime: invalid binding")
    try:
        observed = inspect_runtime(expected["node"]["path"])
    except (KeyError, TypeError) as error:
        raise ValueError("offline check runtime: invalid binding") from error
    if observed != expected:
        raise ValueError("offline check runtime: source, bundle, or runtime binding changed")
    return observed


def pyright_argv(target):
    """Return the wrapper's successful engine argv, without any fallback path."""
    if os.environ.get("AIW_OFFLINE_CHECKS") != "1":
        raise ValueError("offline check runtime: explicit native mode required")
    try:
        expected = json.loads(os.environ["AIW_CHECK_RUNTIME"])
    except (KeyError, ValueError) as error:
        raise ValueError("offline check runtime: missing/invalid binding") from error
    runtime = validate_runtime(expected)
    return [runtime["node"]["path"], runtime["pyright"]["entry"], "--outputjson", target]


def main():
    """Read-only supervisor preflight; an optional stdin binding must match exactly."""
    if len(sys.argv) != 2:
        raise ValueError("offline check runtime: expected bound Node argument")
    supplied = sys.stdin.read(16385)
    if len(supplied) > 16384:
        raise ValueError("offline check runtime: oversized binding")
    runtime = validate_runtime(json.loads(supplied)) if supplied else inspect_runtime(sys.argv[1])
    if runtime["node"]["path"] != sys.argv[1]:
        raise ValueError("offline check runtime: supervisor Node mismatch")
    # Prove that existing executable/library and JS closures actually load offline.
    node = subprocess.run([runtime["node"]["path"], "--version"], capture_output=True, text=True, timeout=10, check=True)
    engine = subprocess.run([runtime["node"]["path"], runtime["pyright"]["entry"], "--version"], capture_output=True, text=True, timeout=10, check=True)
    if engine.stdout.strip() != "pyright " + PYRIGHT_VERSION or node.stdout.strip() != _runtime_lock()["node"]["version"]:
        raise ValueError("offline check runtime: executable version mismatch")
    validate_runtime(runtime)
    print(json.dumps(runtime, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
