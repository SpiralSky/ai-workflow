"""Shared helpers: workspace paths and the language gate."""
import os

SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", ".mypy_cache", ".ruff_cache"}


def resolve(root, rel):
    """Absolute path of a root-relative path; refuses anything outside the root."""
    abs_path = os.path.realpath(os.path.join(root, rel))
    if abs_path != root and not abs_path.startswith(root + os.sep):
        raise ValueError("path outside workspace: %s" % rel)
    return abs_path


def rel(root, abs_path):
    """Root-relative path with `/` separators, or None when outside the root."""
    r = os.path.relpath(abs_path, root)
    return None if r.startswith("..") else r.replace(os.sep, "/")


def lang(path):
    """File extension without dot (`unknown` when none): the `<lang>` of `unsupported language: <lang>`."""
    return os.path.splitext(path)[1].lstrip(".").lower() or "unknown"


def unsupported(path):
    raise ValueError("unsupported language: %s" % lang(path))


def is_python(path):
    return lang(path) in ("py", "pyi")
