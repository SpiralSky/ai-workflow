"""Refactoring methods (rope): renameSymbol, moveSymbol, moveModule, extractFunction, inlineSymbol,
changeSignature, extractVariable, organizeImports.

Every refactoring runs on a scratch copy of the workspace, so the real files are untouched until the
whole change is known to be good: rope computes and applies its ChangeSet(s) in the copy (no
`.ropeproject`, no VCS commands), the copy is compared with the workspace, every changed Python file
must still parse, and only then (unless `dryRun`) the difference is written back, with a rollback if
a write fails. Results are `{changes: [{path, before, after}]}` (text, `null` = absent); the TS side
turns them into the change summary.
"""
import ast
import builtins
import keyword
import os
import re
import shutil
import sys
import tempfile

from . import nav
from .common import SKIP_DIRS, is_python, rel, resolve, unsupported

MAX_COPY_BYTES = 256 * 1024 * 1024
MAX_UNSURE = 20
IGNORED = ["*.pyc", "*~", ".git", ".svn", ".hg", ".venv", "venv", "node_modules", "__pycache__", ".ropeproject",
           ".mypy_cache", ".ruff_cache"]


class Session:
    """A scratch copy of the workspace with a rope project on it."""

    def __init__(self, root):
        from rope.base.fscommands import FileSystemCommands
        from rope.base.project import Project
        self.root = root
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="aiw-refactor-"))
        self.files, self.dirs = set(), set()
        try:
            self._copy()
            prefs = {"ignored_resources": IGNORED, "split_imports": True}
            if os.path.isdir(os.path.join(self.tmp, "src")):
                prefs["source_folders"] = ["src"]
            # FileSystemCommands: never git mv / git rm even when the workspace is a repository
            self.project = Project(self.tmp, ropefolder=None, fscommands=FileSystemCommands(), **prefs)
        except BaseException:
            shutil.rmtree(self.tmp, ignore_errors=True)
            raise

    def _copy(self):
        total = 0
        for dp, dns, fns in os.walk(self.root):
            dns[:] = sorted(d for d in dns if d not in SKIP_DIRS and d != ".ropeproject" and not os.path.islink(os.path.join(dp, d)))
            r = os.path.relpath(dp, self.root)
            r = "" if r == "." else r.replace(os.sep, "/")
            os.makedirs(os.path.join(self.tmp, r), exist_ok=True)
            if r:
                self.dirs.add(r)
            for fn in fns:
                src = os.path.join(dp, fn)
                if os.path.islink(src) or not os.path.isfile(src):
                    continue
                total += os.path.getsize(src)
                if total > MAX_COPY_BYTES:
                    raise ValueError("workspace too large to refactor (over %d MB)" % (MAX_COPY_BYTES // 2 ** 20))
                shutil.copy2(src, os.path.join(self.tmp, r, fn))
                self.files.add((r + "/" + fn) if r else fn)

    def close(self):
        try:
            self.project.close()
        finally:
            shutil.rmtree(self.tmp, ignore_errors=True)

    # -- rope helpers
    def resource(self, path):
        return self.project.get_file(path)

    def do(self, changes):
        self.project.do(changes)

    def offset(self, path, line, col0):
        """Character offset (as rope counts) of a 1-based line and 0-based column in a scratch file."""
        text = self.text(path)
        lines = text.split("\n")
        if not 1 <= line <= len(lines):
            raise ValueError("line out of range: %s" % line)
        return sum(len(x) + 1 for x in lines[:line - 1]) + col0

    def text(self, path):
        return self.resource(path).read()

    def exists(self, path):
        return os.path.exists(os.path.join(self.tmp, path))

    def ensure_dir(self, dir_rel):
        """Creates a missing directory chain; new directories get an `__init__.py` when the nearest existing parent is a package."""
        parts = [x for x in dir_rel.split("/") if x]
        cur = ""
        for part in parts:
            parent = cur
            cur = (cur + "/" + part) if cur else part
            full = os.path.join(self.tmp, cur)
            if os.path.isdir(full):
                continue
            is_pkg = os.path.exists(os.path.join(self.tmp, parent, "__init__.py")) if parent else False
            os.makedirs(full)
            if is_pkg:
                open(os.path.join(full, "__init__.py"), "w").close()

    def create_module(self, path):
        """Creates an empty module file (and package directories) in the copy."""
        self.ensure_dir(os.path.dirname(path))
        full = os.path.join(self.tmp, path)
        if not os.path.exists(full):
            open(full, "w").close()
        return self.resource(path)

    # -- result
    def walk(self):
        files, dirs = set(), set()
        for dp, dns, fns in os.walk(self.tmp):
            r = os.path.relpath(dp, self.tmp)
            r = "" if r == "." else r.replace(os.sep, "/")
            if r:
                dirs.add(r)
            for fn in fns:
                files.add((r + "/" + fn) if r else fn)
        return files, dirs

    def diff(self):
        """Compares the copy with the workspace: a `Delta`."""
        now_files, now_dirs = self.walk()
        d = Delta()
        d.created = sorted(now_files - self.files)
        d.deleted = sorted(self.files - now_files)
        d.modified = sorted(f for f in now_files & self.files if _read(os.path.join(self.tmp, f)) != _read(os.path.join(self.root, f)))
        d.new_dirs = sorted(now_dirs - self.dirs)
        d.gone_dirs = sorted(self.dirs - now_dirs, key=lambda x: -x.count("/"))
        d.s = self
        return d


def _read(path):
    with open(path, "rb") as f:
        return f.read()


def _text(data):
    return None if data is None else data.decode("utf-8", errors="replace")


class Delta:
    """Files and directories that differ between the scratch copy and the workspace."""

    def entries(self):
        out = []
        for f in sorted(self.created + self.modified + self.deleted):
            before = _read(os.path.join(self.s.root, f)) if f not in self.created else None
            after = _read(os.path.join(self.s.tmp, f)) if f not in self.deleted else None
            out.append({"path": f, "before": _text(before), "after": _text(after)})
        return out

    def validate(self):
        """Every created or modified Python file must parse."""
        for f in self.created + self.modified:
            if is_python(f):
                try:
                    ast.parse(_read(os.path.join(self.s.tmp, f)), filename=f)
                except SyntaxError as e:
                    raise ValueError("refactoring would leave invalid syntax in %s (line %s: %s); nothing was changed" % (f, e.lineno, e.msg))

    def empty(self):
        return not (self.created or self.deleted or self.modified)

    def apply(self):
        """Writes the difference into the workspace; restores everything if any step fails."""
        s = self.s
        backups, made_files, made_dirs = {}, [], []
        try:
            for f in self.deleted + self.modified:
                backups[f] = _read(os.path.join(s.root, f))
            for f in self.deleted:
                os.remove(os.path.join(s.root, f))
            for f in self.modified:
                with open(os.path.join(s.root, f), "wb") as out:
                    out.write(_read(os.path.join(s.tmp, f)))
            def mkdirs(full):
                missing = []
                while not os.path.isdir(full):
                    missing.append(full)
                    full = os.path.dirname(full)
                for d in reversed(missing):
                    os.mkdir(d)
                    made_dirs.append(d)
            for d in sorted(self.new_dirs):
                mkdirs(os.path.join(s.root, d))
            for f in self.created:
                dst = os.path.join(s.root, f)
                mkdirs(os.path.dirname(dst))
                made_files.append(dst)
                shutil.copy2(os.path.join(s.tmp, f), dst)
            self._prune()
        except BaseException:
            for f in made_files:
                if os.path.exists(f):
                    os.remove(f)
            for d in reversed(made_dirs):
                try:
                    os.rmdir(d)
                except OSError:
                    pass
            for f, data in backups.items():
                dst = os.path.join(s.root, f)
                try:
                    if os.path.exists(dst) and _read(dst) == data:
                        continue
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    with open(dst, "wb") as out:
                        out.write(data)
                except OSError:
                    pass  # best effort: keep restoring the others
            raise

    def _prune(self):
        """Removes directories that the refactoring emptied (only `__pycache__` may remain in them)."""
        for d in self.gone_dirs:
            full = os.path.join(self.s.root, d)
            if not os.path.isdir(full):
                continue
            left = [os.path.join(dp, f) for dp, _dn, fns in os.walk(full) for f in fns if os.path.basename(dp) != "__pycache__"]
            if not left:
                shutil.rmtree(full, ignore_errors=True)


def run(root, p, build, allow_empty=False):
    """Runs `build(session)` on a scratch copy, validates, and applies unless `dryRun`."""
    try:
        s = Session(root)
    except ImportError:
        raise ValueError("rope is not installed in the tool venv")
    try:
        extra = build(s) or {}
        d = s.diff()
        if d.empty():
            if allow_empty:
                return {"changes": [], **extra}
            raise ValueError("the refactoring changed nothing")
        d.validate()
        entries = d.entries()
        if not p.get("dryRun"):
            d.apply()
            for e in entries:
                nav._ast_cache.pop(os.path.join(root, e["path"]), None)
        return {"changes": entries, **extra}
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(_explain(e))
    finally:
        s.close()


def _explain(e):
    name = type(e).__name__
    msg = str(e).strip()
    if name in ("RefactoringError", "ModuleSyntaxError", "BadIdentifierError", "ResourceNotFoundError", "NameNotFoundError", "ModuleNotFoundError"):
        return "refactoring failed: %s" % (msg or name)
    return "refactoring failed: %s: %s" % (name, msg) if msg else "refactoring failed: %s" % name


def _need_name(name, what="name"):
    if not isinstance(name, str) or not name.isidentifier() or keyword.iskeyword(name):
        raise ValueError("%s must be a valid identifier: %r" % (what, name))
    return name


def _py(root, path, what="path"):
    if not isinstance(path, str) or not path:
        raise ValueError("%s is required" % what)
    if not is_python(path):
        unsupported(path)
    return rel(root, resolve(root, path)) or path


def _char_col(line, byte_col):
    """Character column of a UTF-8 byte column (ast offsets are bytes)."""
    return len(line.encode("utf-8")[:byte_col].decode("utf-8", errors="ignore"))


def _call_at(tree, text, name_end):
    """The Call node whose callee ends at character offset `name_end` of `text`."""
    lines = text.split("\n")
    starts = [0]
    for ln in lines:
        starts.append(starts[-1] + len(ln) + 1)
    for c in ast.walk(tree):
        if isinstance(c, ast.Call) and starts[c.func.end_lineno - 1] + _char_col(lines[c.func.end_lineno - 1], c.func.end_col_offset) == name_end:
            return c
    return None


def _qualname_at(tree, line):
    """Qualified name (A.b) of the function/class defined on `line`, or None."""
    def walk(body, prefix):
        for n in body:
            if isinstance(n, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                q = prefix + n.name
                if n.lineno == line:
                    return q
                hit = walk(n.body, q + ".")
                if hit:
                    return hit
        return None
    return walk(tree.body, "")


def _find_def(tree, qualified):
    body, node = tree.body, None
    for part in qualified.split("."):
        node = next((n for n in body if isinstance(n, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == part), None)
        if node is None:
            return None
        body = node.body
    return node


class Unsure:
    """Decides rope's "unsure" occurrences (uses on receivers whose type rope cannot infer) with jedi.

    An occurrence is taken when jedi resolves it to the definition being refactored (annotations
    count); otherwise it is left alone and listed in `unsure`.
    """

    def __init__(self, s, def_path, def_line, name, record=False):
        import jedi
        self.s, self.def_path, self.def_line, self.name = s, def_path, def_line, name
        self.project = jedi.Project(path=s.tmp)
        self.jedi = jedi
        self.record = record  # True: only note resolved occurrences (the caller rewrites them), never accept
        self.left = []
        self.resolved = []

    def __call__(self, occ):
        path = occ.resource.path
        text = occ.resource.read()
        line = text.count("\n", 0, occ.offset) + 1
        col = occ.offset - (text.rfind("\n", 0, occ.offset) + 1)
        try:
            script = self.jedi.Script(code=text, path=os.path.join(self.s.tmp, path), project=self.project)
            defs = script.goto(line, col, follow_imports=True)
        except Exception:
            defs = []
        for d in defs:
            mp = str(d.module_path) if d.module_path else ""
            if d.name == self.name and d.line == self.def_line and rel(self.s.tmp, mp) == self.def_path:
                if self.record:
                    self.resolved.append((path, occ.offset))
                    return False
                return True
        if len(self.left) < MAX_UNSURE:
            self.left.append({"path": path, "line": line})
        return False

    def extra(self):
        seen = []
        for u in self.left:
            if u not in seen:
                seen.append(u)
        return {"unsure": seen} if seen else {}


# ---- renameSymbol --------------------------------------------------------------------------

def rename_symbol(root, p):
    from rope.refactor.rename import Rename
    new = _need_name(p.get("newName"), "newName")
    path, _abs, line, col = nav.target(root, p)

    def build(s):
        r = s.resource(path)
        decide = Unsure(s, path, line, _name_at(s, path, line, col))
        # in_hierarchy only acts on methods: overriding methods are renamed together
        s.do(Rename(s.project, r, s.offset(path, line, col)).get_changes(new, in_hierarchy=True, unsure=decide))
        return decide.extra()
    return run(root, p, build)


# ---- moveSymbol ----------------------------------------------------------------------------

def _modname(path):
    parts = path[:-3].split("/") if path.endswith(".py") else path.split("/")
    if parts and parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def _add_import(text, line):
    """Inserts an import line after the last top-level import (or after the docstring, or first)."""
    tree = ast.parse(text)
    lines = text.split("\n")
    at = 0
    for n in tree.body:
        if isinstance(n, (ast.Import, ast.ImportFrom)):
            at = n.end_lineno
        elif at == 0 and isinstance(n, ast.Expr) and isinstance(getattr(n, "value", None), ast.Constant) and isinstance(n.value.value, str):
            at = n.end_lineno
    lines.insert(at, line)
    return "\n".join(lines)


def move_symbol(root, p):
    from rope.refactor import move
    dest = _py(root, p.get("to"), "to")
    path, _abs, line, col = nav.target(root, p)
    if path == dest:
        raise ValueError("source and destination are the same module: %s" % dest)
    if p.get("symbol") and "." in p["symbol"].split("#", 1)[1]:
        raise ValueError("moveSymbol moves module-level functions, classes and constants, not %s" % p["symbol"].split("#", 1)[1])
    keep = bool(p.get("keepReexport"))

    def build(s):
        name = _name_at(s, path, line, col)
        s.create_module(dest)
        mover = move.create_move(s.project, s.resource(path), s.offset(path, line, col))
        if not isinstance(mover, move.MoveGlobal):
            raise ValueError("moveSymbol moves module-level functions, classes and constants")
        s.do(mover.get_changes(s.resource(dest)))
        dest_needs_src = _modname(path) in _top_level_imports(dest, s.text(dest))
        src_needs_dest = keep or _modname(dest) in _top_level_imports(path, s.text(path))
        if dest_needs_src and src_needs_dest:
            raise ValueError("the move would create an import cycle between %s and %s; nothing was changed" % (path, dest))
        if keep:
            src = s.text(path)
            mod = _modname(dest)
            tree = ast.parse(src)
            have = any(isinstance(n, ast.ImportFrom) and n.level == 0 and n.module == mod and any(a.name == name and not a.asname for a in n.names)
                       for n in ast.walk(tree) if isinstance(n, ast.ImportFrom))
            if not have:
                s.resource(path).write(_add_import(src, "from %s import %s  # noqa: F401" % (mod, name)))
    return run(root, p, build)


def _name_at(s, path, line, col0):
    text = s.text(path).split("\n")[line - 1]
    i = col0
    while i < len(text) and (text[i].isalnum() or text[i] == "_"):
        i += 1
    return text[col0:i]


# ---- moveModule ----------------------------------------------------------------------------

def move_module(root, p):
    from rope.refactor import move
    from rope.refactor.rename import Rename
    src = p.get("from")
    dst = p.get("to")
    if not isinstance(src, str) or not isinstance(dst, str) or not src or not dst:
        raise ValueError("from and to are required")
    src_abs, dst_abs = resolve(root, src), resolve(root, dst)
    src, dst = rel(root, src_abs), rel(root, dst_abs)
    if src is None or dst is None:
        raise ValueError("path outside workspace")
    if os.path.isfile(src_abs):
        if not is_python(src):
            unsupported(src)
        if not dst.endswith(".py"):
            unsupported(dst)
        is_pkg = False
    elif os.path.isdir(src_abs):
        if not os.path.exists(os.path.join(src_abs, "__init__.py")):
            raise ValueError("not a package (no __init__.py): %s" % src)
        is_pkg = True
    else:
        raise ValueError("no such module or package: %s" % src)
    if src == dst:
        raise ValueError("from and to are the same path")
    if os.path.exists(dst_abs):
        raise ValueError("target exists: %s" % dst)
    if is_pkg and (dst + "/").startswith(src + "/"):
        raise ValueError("cannot move a package into itself")
    sdir, sbase = os.path.dirname(src), os.path.basename(src)
    ddir, dbase = os.path.dirname(dst), os.path.basename(dst)

    def build(s):
        r = s.project.get_folder(src) if is_pkg else s.resource(src)
        if sdir == ddir:
            new = dbase[:-3] if not is_pkg else dbase
            _need_name(new, "new module name")
            s.do(Rename(s.project, r, None).get_changes(new))
        elif sbase == dbase:
            s.ensure_dir(ddir)
            dest = s.project.get_folder(ddir) if ddir else s.project.root
            s.do(move.MoveModule(s.project, r).get_changes(dest))
        else:
            raise ValueError("moveModule changes either the directory or the name per call; do it in two calls (%s -> %s)" % (src, dst))
    return run(root, p, build)


# ---- extractFunction / extractVariable -----------------------------------------------------

def extract_function(root, p):
    from rope.refactor.extract import ExtractMethod
    path = _py(root, p.get("path"))
    name = _need_name(p.get("name"))
    rng = p.get("range")
    if not (isinstance(rng, list) and len(rng) == 2 and all(isinstance(x, int) for x in rng)):
        raise ValueError("range must be [startLine, endLine]")
    start, end = rng
    nav.parse(resolve(root, path))

    def build(s):
        lines = s.text(path).split("\n")
        if not 1 <= start <= end <= len(lines):
            raise ValueError("range out of bounds: [%s, %s] (file has %d lines)" % (start, end, len(lines)))
        first = lines[start - 1]
        a = s.offset(path, start, len(first) - len(first.lstrip()))
        b = s.offset(path, end, len(lines[end - 1].rstrip()))
        s.do(ExtractMethod(s.project, s.resource(path), a, b).get_changes(name))
    return run(root, p, build)


def extract_variable(root, p):
    from rope.refactor.extract import ExtractVariable
    path = _py(root, p.get("path"))
    name = _need_name(p.get("name"))
    line, expr, col = p.get("line"), p.get("expression"), p.get("col")
    scope = p.get("scope") or "local"
    if scope not in ("local", "module"):
        raise ValueError('scope must be "local" or "module"')
    if not isinstance(line, int) or not isinstance(expr, str) or not expr.strip():
        raise ValueError("line and expression are required")
    try:
        ast.parse(expr.strip(), mode="eval")
    except SyntaxError:
        raise ValueError("expression is not a single valid Python expression: %s" % expr)
    abs_path = resolve(root, path)
    lines, tree = nav.parse(abs_path)
    if not 1 <= line <= len(lines):
        raise ValueError("line out of range: %s" % line)
    text = lines[line - 1]
    expr = expr.strip()
    if col is not None:
        at = col - 1
        if text[at:at + len(expr)] != expr:
            raise ValueError("expression not found at %s:%s: %s" % (line, col, expr))
    else:
        hits = []
        i = text.find(expr)
        while i >= 0:
            hits.append(i)
            i = text.find(expr, i + 1)
        if not hits:
            raise ValueError("expression not found on line %d: %s" % (line, expr))
        if len(hits) > 1:
            raise ValueError("expression occurs %d times on line %d; pass col (1-based) to pick one" % (len(hits), line))
        at = hits[0]
    if scope == "module":
        _check_module_scope(tree, line, expr)

    def build(s):
        a = s.offset(path, line, at)
        s.do(ExtractVariable(s.project, s.resource(path), a, a + len(expr)).get_changes(name, global_=scope == "module"))
    return run(root, p, build)


def _module_names(tree):
    names = set(dir(builtins)) | {"__file__", "__name__", "__doc__"}
    for n in tree.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(n.name)
        elif isinstance(n, (ast.Import, ast.ImportFrom)):
            for a in n.names:
                names.add((a.asname or a.name).split(".")[0])
        else:
            for sub in ast.walk(n):
                if isinstance(sub, ast.Name) and isinstance(sub.ctx, ast.Store) and not _inside_def(n):
                    names.add(sub.id)
    return names


def _inside_def(n):
    return isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))


def _check_module_scope(tree, line, expr):
    """scope "module" moves the expression out of its function: it may only use module-level names."""
    node = ast.parse(expr, mode="eval")
    bound = {n.id for n in ast.walk(node) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)}
    for a in ast.walk(node):
        if isinstance(a, ast.arg):
            bound.add(a.arg)
    free = {n.id for n in ast.walk(node) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)} - bound
    bad = sorted(free - _module_names(tree))
    if bad:
        raise ValueError('scope "module" is not possible: the expression uses local names (%s)' % ", ".join(bad))


# ---- inlineSymbol --------------------------------------------------------------------------

_ATOMIC = (ast.Name, ast.Constant, ast.Attribute, ast.Call, ast.Subscript, ast.List, ast.Dict, ast.Set, ast.ListComp,
           ast.DictComp, ast.SetComp, ast.GeneratorExp, ast.JoinedStr)


_SIMPLE_ARG = (ast.Name, ast.Constant)
_SAFE_PARENTS = (ast.Expr, ast.Assign, ast.AnnAssign, ast.AugAssign, ast.Return, ast.keyword, ast.List, ast.Tuple, ast.Set, ast.Dict)


def _is_simple(node):
    """A name, constant or attribute chain on a name: free to repeat and to put anywhere."""
    while isinstance(node, ast.Attribute):
        node = node.value
    return isinstance(node, _SIMPLE_ARG)


def _occurrences(s, name, pyname):
    """[(path, occurrence)] of a name's uses outside import statements, in every workspace file."""
    from rope.refactor import occurrences
    finder = occurrences.create_finder(s.project, name, pyname, imports=False)
    out = []
    for r in s.project.get_python_files():
        for occ in finder.find_occurrences(resource=r):
            out.append((r.path, occ))
    return out


def _check_inline_function(s, inl):
    """Rope substitutes text, so inlining is limited to cases where that is exact."""
    fn = inl.pyfunction
    defpath = fn.get_module().get_resource().path
    tree = ast.parse(s.text(defpath))
    qual = _qualname_at(tree, fn.get_ast().lineno)
    node = _find_def(tree, qual) if qual else None
    if not isinstance(node, ast.FunctionDef):
        raise ValueError("inlineSymbol cannot inline %s" % (qual or "this function"))
    a = node.args
    if node.decorator_list or a.vararg or a.kwarg or a.kwonlyargs or a.posonlyargs:
        raise ValueError("inlineSymbol does not inline functions with decorators, *args/**kwargs or keyword-only/positional-only parameters")
    body = node.body[1:] if len(node.body) > 1 and isinstance(node.body[0], ast.Expr) and isinstance(getattr(node.body[0], "value", None), ast.Constant) else node.body
    if len(body) != 1 or not (isinstance(body[0], ast.Return) and body[0].value is not None or isinstance(body[0], ast.Expr)):
        raise ValueError("inlineSymbol inlines functions whose body is a single return expression or a single expression statement")
    if any(isinstance(x, (ast.Yield, ast.YieldFrom, ast.Await, ast.NamedExpr)) for x in ast.walk(body[0])):
        raise ValueError("inlineSymbol does not inline functions that yield, await or use :=")
    value = body[0].value
    returns = isinstance(body[0], ast.Return)
    compound = not isinstance(value, _ATOMIC)
    calls = {}
    for path, occ in _occurrences(s, inl.name, inl.pyname):
        if occ.is_defined():
            continue
        calls.setdefault(path, []).append(occ)
    if any(isinstance(x, ast.Name) and x.id == inl.name for x in ast.walk(body[0])):
        raise ValueError("inlineSymbol does not inline recursive functions")
    for path, occs in calls.items():
        text = s.text(path)
        tree = ast.parse(text)
        parent = {c: n for n in ast.walk(tree) for c in ast.iter_child_nodes(n)}
        lines = text.split("\n")
        line_start = [0]
        for ln in lines:
            line_start.append(line_start[-1] + len(ln) + 1)

        def end_offset(n):
            return line_start[n.end_lineno - 1] + _char_col(lines[n.end_lineno - 1], n.end_col_offset)
        sites = {end_offset(c.func): c for c in ast.walk(tree) if isinstance(c, ast.Call)}
        for occ in occs:
            call = sites.get(occ.offset + len(inl.name))
            where = "%s:%d" % (path, text.count("\n", 0, occ.offset) + 1)
            if call is None:
                raise ValueError("%s is used other than by calling it (%s); inlineSymbol needs every use to be a call" % (inl.name, where))
            if call.keywords and any(k.arg is None for k in call.keywords) or any(isinstance(x, ast.Starred) for x in call.args):
                raise ValueError("call at %s uses * or ** arguments" % where)
            for arg in [*call.args, *[k.value for k in call.keywords]]:
                if not _is_simple(arg):
                    raise ValueError("call at %s passes a compound expression; assign it to a variable first so inlining cannot repeat or reorder it" % where)
            par = parent.get(call)
            if not returns and not isinstance(par, ast.Expr):
                raise ValueError("call at %s uses the result of a function that returns nothing" % where)
            if returns and compound and not (isinstance(par, _SAFE_PARENTS) or (isinstance(par, ast.Call) and call in par.args)):
                raise ValueError("call at %s sits inside a larger expression and the body is compound; assign the call to a variable first" % where)


def _check_inline_variable(s, inl, value):
    """A call-containing value may only be inlined where it is used once."""
    if not any(isinstance(x, (ast.Call, ast.Await, ast.Yield, ast.YieldFrom, ast.NamedExpr)) for x in ast.walk(value)):
        return
    uses = [1 for _p, occ in _occurrences(s, inl.name, inl.pyname) if not occ.is_defined() and not occ.is_written()]
    if len(uses) != 1:
        raise ValueError("the value of %s calls something and is used %d times; inlining would repeat the call" % (inl.name, len(uses)))


def _parenthesize_value(s, inl):
    """Wraps a non-atomic assigned value in parentheses so inlining it cannot change operator precedence."""
    mod, line = inl.pyname.get_definition_location()
    if mod is None or line is None:
        return
    path = mod.get_resource().path
    text = s.text(path)
    node = next((n for n in ast.walk(ast.parse(text)) if isinstance(n, ast.Assign) and n.lineno == line and len(n.targets) == 1
                 and isinstance(n.targets[0], ast.Name)), None)
    if node is None:
        raise ValueError("inlineSymbol inlines variables assigned once with a plain `name = value`")
    _check_inline_variable(s, inl, node.value)
    if isinstance(node.value, _ATOMIC):
        return
    v = node.value
    lines = text.split("\n")
    l0, c0 = v.lineno - 1, _char_col(lines[v.lineno - 1], v.col_offset)
    l1, c1 = v.end_lineno - 1, _char_col(lines[v.end_lineno - 1], v.end_col_offset)
    if lines[l0][c0 - 1:c0] == "(" and lines[l1][c1:c1 + 1] == ")":
        return
    lines[l1] = lines[l1][:c1] + ")" + lines[l1][c1:]
    lines[l0] = lines[l0][:c0] + "(" + lines[l0][c0:]
    s.resource(path).write("\n".join(lines))


def inline_symbol(root, p):
    from rope.refactor import inline
    path, _abs, line, col = nav.target(root, p)

    def build(s):
        inl = inline.create_inline(s.project, s.resource(path), s.offset(path, line, col))
        if isinstance(inl, inline.InlineParameter):
            raise ValueError("inlineSymbol inlines functions and variables, not parameters")
        if isinstance(inl, inline.InlineVariable):
            _parenthesize_value(s, inl)
            inl = inline.create_inline(s.project, s.resource(path), s.offset(path, line, col))
        else:
            _check_inline_function(s, inl)
        s.do(inl.get_changes(remove=True, only_current=False))
    return run(root, p, build)


# ---- changeSignature -----------------------------------------------------------------------

def _def_offset(s, path, node):
    """Rope offset of the name in a `def`/`class` statement."""
    lines = s.text(path).split("\n")
    text = lines[node.lineno - 1]
    m = re.compile(r"(?:def|class)\s+(%s)\b" % re.escape(node.name)).search(text, node.col_offset)
    return s.offset(path, node.lineno, m.start(1))


def _group_ops(ops):
    """Consecutive add/remove/reorder ops form one rope call; each rename is its own step."""
    groups = []
    for op in ops:
        kind = op.get("op") if isinstance(op, dict) else None
        if kind not in ("add", "remove", "rename", "reorder"):
            raise ValueError("each op needs op: add | remove | rename | reorder")
        if kind == "rename" or not groups or groups[-1][0] == "rename":
            groups.append(("rename" if kind == "rename" else "sig", [op]))
        else:
            groups[-1][1].append(op)
    return groups


def _param_nodes(node):
    a = node.args
    return [*a.posonlyargs, *a.args, *a.kwonlyargs] + ([a.vararg] if a.vararg else []) + ([a.kwarg] if a.kwarg else [])


def change_signature(root, p):
    from rope.refactor import change_signature as cs_mod
    ops = p.get("ops")
    if not isinstance(ops, list) or not ops:
        raise ValueError("ops must be a non-empty list")
    groups = _group_ops(ops)
    path, _abs, line, col = nav.target(root, p)

    def build(s):
        from rope.refactor.rename import Rename
        unsure_total = []
        cs = cs_mod.ChangeSignature(s.project, s.resource(path), s.offset(path, line, col))
        pyfunc = cs.pyname.get_object()
        defpath = pyfunc.get_module().get_resource().path
        if not is_python(defpath):
            raise ValueError("the function is defined outside the workspace")
        qual = _qualname_at(ast.parse(s.text(defpath)), pyfunc.get_ast().lineno)
        if not qual:
            raise ValueError("cannot locate the function definition")
        for kind, group in groups:
            node = _find_def(ast.parse(s.text(defpath)), qual)
            if kind == "rename":
                op = group[0]
                old, new = op.get("name"), _need_name(op.get("to"), "to")
                arg = next((a for a in _param_nodes(node) if a.arg == old), None)
                if arg is None:
                    raise ValueError("no parameter %s in %s" % (old, qual))
                if any(a.arg == new for a in _param_nodes(node)):
                    raise ValueError("parameter already exists: %s" % new)
                s.do(Rename(s.project, s.resource(defpath), s.offset(defpath, arg.lineno, arg.col_offset)).get_changes(new))
                continue
            if node.args.posonlyargs or node.args.kwonlyargs:
                raise ValueError("changeSignature does not support positional-only or keyword-only parameters (%s)" % qual)
            sig = cs_mod.ChangeSignature(s.project, s.resource(defpath), _def_offset(s, defpath, node))
            args = [list(a) for a in sig.get_args()]
            old_text = s.text(defpath)
            old_ann = {a.arg: ast.get_source_segment(old_text, a.annotation) for a in node.args.args if a.annotation}
            changers = []
            for op in group:
                names = [a[0] for a in args]

                def index(n):
                    if n not in names:
                        raise ValueError("no parameter %s in %s (parameters: %s)" % (n, qual, ", ".join(names)))
                    return names.index(n)
                if op["op"] == "add":
                    new = _need_name(op.get("name"), "name")
                    default = op.get("default")
                    if not isinstance(default, str) or not default.strip():
                        raise ValueError("add needs a default (source text of the default value)")
                    try:
                        ast.parse(default, mode="eval")
                    except SyntaxError:
                        raise ValueError("default is not a valid expression: %s" % default)
                    if new in names:
                        raise ValueError("parameter already exists: %s" % new)
                    at = op.get("index", len(args))
                    if not isinstance(at, int) or not 0 <= at <= len(args):
                        raise ValueError("index must be between 0 and %d" % len(args))
                    if any(a[1] is None for a in args[at:]):
                        raise ValueError("a parameter with a default cannot come before one without; pick a later index")
                    changers.append(cs_mod.ArgumentAdder(at, new, default))
                    args.insert(at, [new, default])
                elif op["op"] == "remove":
                    n = op.get("name")
                    i = index(n)
                    for sub in ast.walk(ast.Module(body=node.body, type_ignores=[])):
                        if isinstance(sub, ast.Name) and sub.id == n:
                            raise ValueError("parameter %s is still used in the body (line %d); remove its uses first" % (n, sub.lineno))
                    changers.append(cs_mod.ArgumentRemover(i))
                    del args[i]
                else:
                    order = op.get("order")
                    if not isinstance(order, list) or sorted(order) != sorted(names):
                        raise ValueError("order must list every parameter exactly once: %s" % ", ".join(names))
                    changers.append(cs_mod.ArgumentReorderer([names.index(n) for n in order]))
                    args = [args[names.index(n)] for n in order]
            old_names = [x[0] for x in sig.get_args()]
            is_method = sig.is_method()
            probe = Unsure(s, defpath, node.lineno, node.name, record=True)
            _with_unsure(probe, lambda: sig.get_changes(changers, in_hierarchy=is_method))
            if probe.resolved:
                # typed receivers rope cannot see through (x: K; x.m(...)): rewrite those calls here, first
                unsure_total.extend(_rewrite_calls(s, probe.resolved, node.name, old_names, [x[0] for x in args], is_method))
                sig = cs_mod.ChangeSignature(s.project, s.resource(defpath), _def_offset(s, defpath, _find_def(ast.parse(s.text(defpath)), qual)))
            decide = Unsure(s, defpath, node.lineno, node.name, record=True)
            unsure_total.extend(_with_unsure(decide, lambda: s.do(sig.get_changes(changers, in_hierarchy=is_method))))
            _fix_definition(s, defpath, qual, args, old_ann)
        seen = []
        for u in unsure_total:
            if u not in seen:
                seen.append(u)
        return {"unsure": seen[:MAX_UNSURE]} if seen else {}
    return run(root, p, build)


def _rewrite_calls(s, sites, name, old, new, is_method):
    """Rewrites `recv.name(...)` calls jedi resolved to the function: arguments follow the new parameter order.

    Returns the sites that cannot be rewritten safely (star arguments, unknown keywords, plain functions).
    """
    bad = []
    by_path = {}
    for path, off in sites:
        by_path.setdefault(path, set()).add(off)
    skip = 1 if is_method else 0
    old, new = old[skip:], new[skip:]
    for path, offs in by_path.items():
        text = s.text(path)
        tree = ast.parse(text)
        lines = text.split("\n")
        starts = [0]
        for ln in lines:
            starts.append(starts[-1] + len(ln) + 1)

        def pos(line, col):
            return starts[line - 1] + _char_col(lines[line - 1], col)
        edits = []
        for off in sorted(offs, reverse=True):
            call = _call_at(tree, text, off + len(name))
            where = {"path": path, "line": text.count("\n", 0, off) + 1}
            nodes = [*call.args, *call.keywords] if call else []
            if not call or not is_method or not isinstance(call.func, ast.Attribute) or any(isinstance(a, ast.Starred) for a in call.args) \
                    or any(k.arg is None or k.arg not in old for k in call.keywords) or len(call.args) > len(old):
                bad.append(where)
                continue
            bound = {old[i]: ast.get_source_segment(text, a) for i, a in enumerate(call.args)}
            if any(k.arg in bound for k in call.keywords):
                bad.append(where)
                continue
            bound.update({k.arg: ast.get_source_segment(text, k.value) for k in call.keywords})
            parts, gap = [], False
            for n in new:
                if n not in bound:
                    gap = True
                elif gap:
                    parts.append("%s=%s" % (n, bound[n]))
                else:
                    parts.append(bound[n])
            if not nodes:
                continue
            a = min(pos(n.lineno, n.col_offset) for n in nodes)
            b = max(pos(n.end_lineno, n.end_col_offset) for n in nodes)
            edits.append((a, b, ", ".join(parts)))
        for a, b, new_text in sorted(edits, reverse=True):
            text = text[:a] + new_text + text[b:]
        if edits:
            s.resource(path).write(text)
    return bad


def _with_unsure(decide, action):
    """Runs a rope call that builds a call-site finder with `decide` as its unsure handler (rope's ChangeSignature has no such option)."""
    from rope.refactor import change_signature, occurrences
    original = occurrences.create_finder

    def create(*a, **kw):
        kw.setdefault("unsure", decide)
        return original(*a, **kw)
    change_signature.occurrences.create_finder = create
    try:
        action()
    finally:
        change_signature.occurrences.create_finder = original
    return decide.left


def _fix_definition(s, defpath, qual, expected, old_ann):
    """Checks the rewritten definition against the intended parameters and puts back the annotations rope drops."""
    text = s.text(defpath)
    node = _find_def(ast.parse(text), qual)
    a = node.args
    got = [(x.arg, ast.get_source_segment(text, d) if d is not None else None)
           for x, d in zip(a.args, [None] * (len(a.args) - len(a.defaults)) + list(a.defaults))]
    want = [(n, d) for n, d in expected]
    norm = lambda v: ast.dump(ast.parse(v, mode="eval")) if v is not None else None  # noqa: E731
    if [g[0] for g in got] != [w[0] for w in want] or [norm(g[1]) for g in got] != [norm(w[1]) for w in want]:
        raise ValueError("rope rewrote the signature of %s unexpectedly; nothing was changed" % qual)
    lines = text.split("\n")
    defaults = [None] * (len(a.args) - len(a.defaults)) + list(a.defaults)
    edits = []
    for x, d in zip(a.args, defaults):
        if x.annotation is None and x.arg in old_ann:
            end_node = d if d is not None else x
            edits.append((x, end_node, old_ann[x.arg], ast.get_source_segment(text, d) if d is not None else None))
    for x, end_node, ann, default in sorted(edits, key=lambda e: (e[0].lineno, e[0].col_offset), reverse=True):
        l0, c0 = x.lineno - 1, _char_col(lines[x.lineno - 1], x.col_offset)
        l1, c1 = end_node.end_lineno - 1, _char_col(lines[end_node.end_lineno - 1], end_node.end_col_offset)
        new = "%s: %s%s" % (x.arg, ann, " = " + default if default is not None else "")
        lines[l0:l1 + 1] = [lines[l0][:c0] + new + lines[l1][c1:]]
    if edits:
        s.resource(defpath).write("\n".join(lines))


# ---- organizeImports -----------------------------------------------------------------------
#
# Rope's organizer removes unused imports (keeping names in `__all__`), drops duplicates and sorts.
# In `__init__.py` unused imports are kept: they are re-exports. On top of that, function-local imports
# are hoisted to module level only when ALL of these hold (otherwise they stay and are reported):
#   1. the import is a direct statement of a function body (not under if/try/with/loop; not star);
#   2. its module is stdlib, or a workspace module that cannot import this file back (no import cycle,
#      checked through every import in the workspace, lazy ones included); third-party and unknown
#      modules are never hoisted (optional dependencies, import-time side effects);
#   3. the bound name does not clash with a different module-level binding or another binding in the
#      same function; an identical module-level import just makes the local one redundant;
#   4. the function keeps at least one other statement, and the import shares no line with other code.

_NEVER_HOIST = {"this", "antigravity", "__main__", "idlelib", "turtledemo"}


def _package_of(path):
    parts = _modname(path).split(".") if _modname(path) else []
    return parts if path.endswith("__init__.py") else parts[:-1]


def _resolve_import(path, node):
    """Dotted module names an Import/ImportFrom in `path` may load (the module and `module.name` candidates)."""
    if isinstance(node, ast.Import):
        return [a.name for a in node.names]
    if node.level:
        pkg = _package_of(path)
        base = pkg[:len(pkg) - (node.level - 1)] if node.level > 1 else pkg
        mod = ".".join(base + ([node.module] if node.module else []))
    else:
        mod = node.module or ""
    return [mod] + [mod + "." + a.name for a in node.names if a.name != "*"] if mod else []


def _top_level_imports(path, text):
    """Dotted modules imported by statements that run at import time (not inside functions or classes)."""
    out = set()

    def visit(body):
        for n in body:
            if isinstance(n, (ast.Import, ast.ImportFrom)):
                out.update(_resolve_import(path, n))
            elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                continue
            else:
                for field in ("body", "orelse", "finalbody"):
                    visit(getattr(n, field, []) or [])
                for h in getattr(n, "handlers", []) or []:
                    visit(h.body)
    visit(ast.parse(text).body)
    return out


class _Workspace:
    """Module name -> files for the workspace, and import closures between them."""

    def __init__(self, root):
        self.root = root
        self.mods = {}
        self._imports = {}
        for dp, dns, fns in os.walk(root):
            dns[:] = sorted(d for d in dns if d not in SKIP_DIRS and not os.path.exists(os.path.join(dp, d, "pyvenv.cfg")))
            for fn in fns:
                if fn.endswith(".py"):
                    path = rel(root, os.path.join(dp, fn))
                    self.mods.setdefault(_modname(path), path)
                    if path.startswith("src/"):
                        self.mods.setdefault(_modname(path[4:]), path)

    def files_of(self, dotted):
        """Files imported by `import dotted`: the module and the `__init__` of every parent package."""
        parts = dotted.split(".")
        out = []
        for i in range(1, len(parts) + 1):
            f = self.mods.get(".".join(parts[:i]))
            if f:
                out.append(f)
        return out if self.mods.get(dotted) else []

    def resolve(self, path, node):
        return _resolve_import(path, node)

    def imports_of(self, path):
        hit = self._imports.get(path)
        if hit is None:
            hit = set()
            try:
                with open(os.path.join(self.root, path), "rb") as f:
                    tree = ast.parse(f.read())
            except (OSError, SyntaxError, ValueError):
                tree = ast.Module(body=[], type_ignores=[])
            for n in ast.walk(tree):
                if isinstance(n, (ast.Import, ast.ImportFrom)):
                    for d in self.resolve(path, n):
                        hit.update(self.files_of(d))
            self._imports[path] = hit
        return hit

    def reaches(self, start_files, target):
        seen, todo = set(), list(start_files)
        while todo:
            f = todo.pop()
            if f == target:
                return True
            if f in seen:
                continue
            seen.add(f)
            todo.extend(self.imports_of(f))
        return False


def _module_bindings(tree):
    """name -> set of origins bound at module level (imports by origin, anything else as 'other')."""
    out = {}

    def add(name, origin):
        out.setdefault(name, set()).add(origin)

    def visit(body):
        for n in body:
            if isinstance(n, (ast.Import, ast.ImportFrom)):
                for a in n.names:
                    b, o = _import_binding(n, a)
                    add(b, o)
            elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                add(n.name, "other")
            else:
                for sub in ast.walk(n):
                    if isinstance(sub, ast.Name) and isinstance(sub.ctx, (ast.Store, ast.Del)):
                        add(sub.id, "other")
                    elif isinstance(sub, (ast.Import, ast.ImportFrom)):
                        for a in sub.names:
                            b, o = _import_binding(sub, a)
                            add(b, o)
                    elif isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                        add(sub.name, "other")
    visit(tree.body)
    return out


def _import_binding(node, alias):
    """(bound name, origin) of one imported alias."""
    if isinstance(node, ast.Import):
        if alias.asname:
            return alias.asname, ("import", alias.name)
        top = alias.name.split(".")[0]
        return top, ("import", top)
    return alias.asname or alias.name, ("from", node.level, node.module, alias.name)


def _function_bindings(fn, skip):
    """Names bound in a function other than by the `skip` statement."""
    out = {a.arg for a in _param_nodes(fn)}
    todo = list(fn.body)
    while todo:
        n = todo.pop()
        if n is skip:
            continue
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            out.add(n.name)
            continue
        if isinstance(n, ast.Lambda):
            continue
        if isinstance(n, ast.Name) and isinstance(n.ctx, (ast.Store, ast.Del)):
            out.add(n.id)
        if isinstance(n, (ast.Import, ast.ImportFrom)):
            for a in n.names:
                out.add(_import_binding(n, a)[0])
        if isinstance(n, ast.ExceptHandler) and n.name:
            out.add(n.name)
        todo.extend(ast.iter_child_nodes(n))
    return out


def _hoist(ws, path, text):
    """(new text, hoisted, kept) for a module: see the rules above."""
    tree = ast.parse(text)
    lines = text.split("\n")
    bindings = _module_bindings(tree)
    hoisted, kept, remove, add = [], [], [], []
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for n in fn.body:
            if not isinstance(n, (ast.Import, ast.ImportFrom)):
                continue
            src = "\n".join(lines[n.lineno - 1:n.end_lineno]).strip()
            why = _why_not(ws, path, fn, n, lines, bindings)
            if why:
                kept.append({"line": n.lineno, "statement": src, "reason": why})
                continue
            for a in n.names:
                b, o = _import_binding(n, a)
                bindings.setdefault(b, set()).add(o)
                add.append(_render(n, a))
            remove.append((n.lineno, n.end_lineno))
            hoisted.append({"line": n.lineno, "statement": src})
    for a, b in sorted(remove, reverse=True):
        del lines[a - 1:b]
    out = "\n".join(lines)
    for stmt in reversed(add):
        out = _add_import(out, stmt)
    return out, hoisted, kept


def _render(node, alias):
    nm = alias.name + (" as " + alias.asname if alias.asname else "")
    if isinstance(node, ast.Import):
        return "import " + nm
    return "from %s%s import %s" % ("." * node.level, node.module or "", nm)


def _why_not(ws, path, fn, node, lines, bindings):
    """None when the import may be hoisted, else the reason it stays."""
    if any(a.name == "*" for a in node.names):
        return "star import"
    if len(fn.body) < 2 or sum(1 for x in fn.body if x is not node and not (isinstance(x, ast.Expr) and isinstance(getattr(x, "value", None), ast.Constant))) < 1:
        return "it is the only statement of the function"
    before = lines[node.lineno - 1][:node.col_offset]
    after = lines[node.end_lineno - 1][node.end_col_offset:].strip()
    if before.strip() or (after and not after.startswith("#")):
        return "shares a line with other code"
    for mod in _modules(ws, path, node):
        if not _safe_module(ws, path, node, mod):
            return "not stdlib and may cause an import cycle or import-time side effects: %s" % mod
    local = _function_bindings(fn, node)
    for a in node.names:
        b, o = _import_binding(node, a)
        if b in local:
            return "name %s is also bound elsewhere in the function" % b
        if bindings.get(b) and o not in bindings[b]:
            return "name %s is already bound differently at module level" % b
    return None


def _modules(ws, path, node):
    """(kind, dotted-or-relative) modules the statement loads, for the safety check."""
    if isinstance(node, ast.Import):
        return [a.name for a in node.names]
    return [("." * node.level) + (node.module or "")]


def _safe_module(ws, path, node, mod):
    if not mod.startswith("."):
        top = mod.split(".")[0]
        if top in sys.stdlib_module_names and top not in _NEVER_HOIST and not ws.files_of(mod):
            return True
        dotted = [mod]
    else:
        dotted = [d for d in ws.resolve(path, node)[:1]]
    files = [f for d in dotted for f in ws.files_of(d)]
    if isinstance(node, ast.ImportFrom):
        for d in ws.resolve(path, node)[1:]:
            files += ws.files_of(d)
    if not files or path in files:
        return False
    return not ws.reaches(files, path)


def organize_imports(root, p):
    from rope.refactor.importutils import ImportTools
    path = _py(root, p.get("path"))
    abs_path = resolve(root, path)
    if not os.path.isfile(abs_path):
        raise ValueError("no such file: %s" % path)
    nav.parse(abs_path)
    ws = _Workspace(root)

    def build(s):
        res = s.resource(path)
        text, hoisted, kept = _hoist(ws, path, res.read())
        if text != res.read():
            res.write(text)
        mod = s.project.get_pymodule(res)
        new = ImportTools(s.project).organize_imports(mod, unused=os.path.basename(path) != "__init__.py")
        if new != res.read():
            res.write(new)
        extra = {}
        if hoisted:
            extra["hoisted"] = hoisted[:MAX_UNSURE]
        if kept:
            extra["notHoisted"] = kept[:MAX_UNSURE]
        return extra
    return run(root, p, build, allow_empty=True)


# ---- replaceSymbol -------------------------------------------------------------------------

def _find_def_checked(tree, qualified, symbol):
    """Find a named symbol in the AST, raising `symbol not found` or `ambiguous symbol` as needed.

    Walks the `qualified` dotted path (e.g. ``Class.method``) through the tree body at each level,
    checking for duplicate names to detect ambiguity.
    """
    body = tree.body
    node = None
    for part in qualified.split("."):
        matches = [n for n in body if isinstance(n, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == part]
        if len(matches) == 0:
            raise ValueError("symbol not found: %s" % symbol)
        if len(matches) > 1:
            raise ValueError("ambiguous symbol: %s" % symbol)
        node = matches[0]
        body = node.body
    if node is None:
        raise ValueError("symbol not found: %s" % symbol)
    return node


def replace_symbol(root, p):
    """Replace the entire body of a named Python symbol by address.

    Locates the symbol via AST, then replaces from the first decorator (or ``def``/``class``
    line) through the end of the node, writing ``content`` as-is.  Validates with ``run``
    so the result always parses.
    """
    symbol = p.get("symbol")
    if not isinstance(symbol, str) or "#" not in symbol:
        raise ValueError("symbol must be path#Name or path#Class.method")
    path_part, qualified = symbol.split("#", 1)
    if not qualified:
        raise ValueError("symbol must be path#Name or path#Class.method")
    path = _py(root, path_part)
    abs_path = resolve(root, path)
    content = p.get("content")
    if not isinstance(content, str):
        raise ValueError("content is required")

    lines_list, tree = nav.parse(abs_path)
    node = _find_def_checked(tree, qualified, symbol)
    # First decorator line (if any), else the def/class line itself
    start_line = node.decorator_list[0].lineno if node.decorator_list else node.lineno
    end_line = node.end_lineno

    def build(s):
        text = s.text(path)
        file_lines = text.split("\n")
        replacement = content.splitlines()
        new_lines = file_lines[:start_line - 1] + replacement + file_lines[end_line:]
        s.resource(path).write("\n".join(new_lines))

    return run(root, p, build)


METHODS = {
    "renameSymbol": rename_symbol,
    "moveSymbol": move_symbol,
    "moveModule": move_module,
    "extractFunction": extract_function,
    "inlineSymbol": inline_symbol,
    "changeSignature": change_signature,
    "extractVariable": extract_variable,
    "organizeImports": organize_imports,
    "replaceSymbol": replace_symbol,
}
