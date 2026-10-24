"""Graph methods: overview, callGraph, importGraph, impact, dataFlow.

Index (I-02, `ast` first): every `.py` file under the workspace is parsed once into a `FileInfo`
(symbols, imports, call sites, attribute/global accesses, thread/task launches), cached by
(path, mtime_ns) and re-parsed only when it changes. Cross-file resolution (call targets, class
bases, import edges) is recomputed lazily after any file changed.

Call resolution, in order (each step is purely syntactic, no execution):
  * a bare name: enclosing nested defs, local aliases, module-level def/class, `from x import f`
    (followed through re-exports, up to 6 hops), else builtin/external (no edge);
  * `self.m()` / `cls.m()` / `super().m()`: the class and its workspace MRO (depth-first over
    resolved bases);
  * `mod.f()` and `pkg.mod.f()` through `import` / `from pkg import mod` aliases;
  * `Class.m()`, `Class(...)` (edge to `__init__` found on the MRO, else to the class);
  * `var.m()` where `var` has a known type: annotated parameter, `var = Class(...)`, annotated
    local, or `self.attr` typed by `self.attr = Class(...)` / an annotation (one hop of inference);
  * otherwise, for an unresolved receiver: a method name defined exactly once in the workspace
    gives an `approx` edge; a name defined in several classes goes to jedi `goto` (at most
    JEDI_BUDGET lookups per rebuild, results cached per file) and the edge is `approx` too.
Known blind spots: dynamic dispatch (`getattr`, registries, callbacks passed as values other than
thread/task targets), decorators that replace a function, `functools.partial`, values returned from
calls (`make().run()` only resolves for constructors), duck-typed receivers with duplicated method
names beyond the jedi budget, `from x import *`, conditional redefinitions (last def wins), code in
files with syntax errors (skipped), and non-`.py` sources. Import cycles ignore imports inside
functions and `if TYPE_CHECKING:` blocks (they do not close a cycle at import time).
"""
import ast
import builtins
import os

from .common import SKIP_DIRS, is_python, lang, rel, resolve, unsupported
from .nav import parse, _jedi

MAX_FILES = 5000
JEDI_BUDGET = 150
MAX_CANDIDATES = 5
MAX_DEPTH = 5
HOPS = 6
FILE_EXTS = {"py", "pyi", "js", "jsx", "ts", "tsx", "json", "md", "yaml", "yml", "toml", "txt", "go", "rs", "java", "c", "h", "cpp"}
MUTATORS = {"append", "extend", "add", "update", "pop", "remove", "clear", "insert", "setdefault", "discard",
            "popitem", "appendleft", "extendleft", "popleft", "sort", "reverse", "put", "put_nowait"}
THREAD_CTORS = {"Thread": ("thread", "target", None), "Process": ("thread", "target", None), "Timer": ("thread", "function", 1)}
EXECUTOR_CALLS = {"submit": 0, "apply_async": 0, "to_thread": 0, "run_in_executor": 1}
TASK_CALLS = {"create_task", "ensure_future", "run_coroutine_threadsafe"}
BUILTIN_NAMES = set(dir(builtins))


# ---- per-file facts ------------------------------------------------------------------------

class Scope:
    """A function or module body: names it binds and what it knows about their types."""

    def __init__(self, qname, parent=None, cls=None, first_param=None, is_async=False):
        self.qname, self.parent, self.cls = qname, parent, cls
        self.first_param, self.is_async = first_param, is_async
        self.types, self.aliases, self.nested = {}, {}, {}
        self.locals, self.globals_decl = set(), set()


class FileInfo:
    """Everything the graph tools need from one file (no cross-file knowledge)."""

    def __init__(self, path, module, pkg, is_init, mtime):
        self.path, self.module, self.pkg, self.is_init, self.mtime = path, module, pkg, is_init, mtime
        self.lines = 0
        self.symbols = {}  # qname -> {kind, line, end, cls, bases, async}
        self.scopes = {"<module>": Scope("<module>")}
        self.imports = []  # {line, lazy, mod, names}
        self.calls = []  # (parts, line, jline, jcol, scope)
        self.spawns = []  # (kind, parts, line, scope)
        self.attrs = []  # (base parts, attr, kind, line, col, scope)
        self.names = []  # (name, kind, line, col, scope)
        self.module_vars = {}  # name -> first line
        self.class_attr_types = {}  # (cls, attr) -> parts
        self.class_attr_lines = {}  # (cls, attr) -> line
        self.main_blocks = []
        self.all_names = None
        self.jedi_cache = {}


def chain(node):
    """Name/Attribute chain as a list of parts; a call in the chain marks its part `name()`; None when not a chain."""
    tail = []
    while True:
        if isinstance(node, ast.Attribute):
            tail.append(node.attr)
            node = node.value
        elif isinstance(node, ast.Name):
            tail.append(node.id)
            return tail[::-1]
        elif isinstance(node, ast.Call):
            inner = chain(node.func)
            if inner is None:
                return None
            return inner[:-1] + [inner[-1] + "()"] + tail[::-1]
        else:
            return None


def ann_chain(node):
    """Class chain named by an annotation (`X`, `"X"`, `Optional[X]`, `X | None`); None for containers/others."""
    if node is None:
        return None
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        try:
            node = ast.parse(node.value, mode="eval").body
        except SyntaxError:
            return None
    if isinstance(node, ast.Subscript):
        base = chain(node.value)
        if base and base[-1] in ("Optional", "Union", "Annotated", "Final", "ClassVar"):
            sl = node.slice
            if isinstance(sl, ast.Tuple):
                sl = sl.elts[0] if sl.elts else None
            return ann_chain(sl)
        return None
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        return ann_chain(node.left) or ann_chain(node.right)
    return chain(node)


def _local_names(fn):
    """(locals, declared global) of a function body, not descending into nested scopes."""
    loc, glob = set(), set()
    a = fn.args
    for x in a.posonlyargs + a.args + a.kwonlyargs + [a.vararg, a.kwarg]:
        if x is not None:
            loc.add(x.arg)

    def walk(n):
        for c in ast.iter_child_nodes(n):
            if isinstance(c, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                loc.add(c.name)
                continue
            if isinstance(c, ast.Lambda):
                continue
            if isinstance(c, ast.Name) and isinstance(c.ctx, (ast.Store, ast.Del)):
                loc.add(c.id)
            elif isinstance(c, (ast.Import, ast.ImportFrom)):
                for al in c.names:
                    loc.add((al.asname or al.name).split(".")[0])
            elif isinstance(c, ast.ExceptHandler) and c.name:
                loc.add(c.name)
            elif isinstance(c, (ast.Global, ast.Nonlocal)):
                (glob if isinstance(c, ast.Global) else loc).update(c.names)
            walk(c)

    for st in fn.body:
        if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            loc.add(st.name)
        else:
            walk(ast.Module(body=[st], type_ignores=[]))
    return loc - glob, glob


def _is_main_test(t):
    return (isinstance(t, ast.Compare) and isinstance(t.left, ast.Name) and t.left.id == "__name__"
            and len(t.comparators) == 1 and isinstance(t.comparators[0], ast.Constant) and t.comparators[0].value == "__main__")


def _is_type_checking(t):
    return (isinstance(t, ast.Name) and t.id == "TYPE_CHECKING") or (isinstance(t, ast.Attribute) and t.attr == "TYPE_CHECKING")


class Indexer(ast.NodeVisitor):
    """Single pass over a module filling a `FileInfo`."""

    def __init__(self, fi):
        self.fi = fi
        self.scope = fi.scopes["<module>"]
        self.stack = []  # [(kind, qname)] of enclosing class/def, innermost last
        self.tc = 0  # depth of `if TYPE_CHECKING:` blocks
        self.target = None  # AugAssign target node being visited
        self.in_class_body = False

    # -- helpers
    def qual(self, name):
        return self.stack[-1][1] + "." + name if self.stack else name

    def cur_class(self):
        return self.stack[-1][1] if self.stack and self.stack[-1][0] == "class" else None

    def attr_pos(self, node):
        return node.end_lineno, node.end_col_offset - len(node.attr) + 1

    def add_attr(self, node, kind):
        base = chain(node.value)
        if base:
            line, col = self.attr_pos(node)
            self.fi.attrs.append((tuple(base), node.attr, kind, line, col, self.scope.qname))

    def add_name(self, node, kind):
        sc = self.scope
        if self.in_class_body:
            return
        if sc.qname == "<module>" or node.id in sc.globals_decl or node.id not in sc.locals:
            self.fi.names.append((node.id, kind, node.lineno, node.col_offset + 1, sc.qname))

    def note_type(self, target, value):
        """Records `x = Class(...)` / `self.a = x` type hints for the current scope or the enclosing class."""
        parts = None
        if isinstance(value, ast.Call):
            parts = chain(value.func)
        elif isinstance(value, ast.Name) and value.id in self.scope.types:
            parts = self.scope.types[value.id]
        if not parts:
            return
        self.record_type(target, parts)

    def record_type(self, target, parts):
        sc = self.scope
        if isinstance(target, ast.Name) and not self.in_class_body:
            sc.types[target.id] = parts
        elif isinstance(target, ast.Name) and self.in_class_body:
            self.fi.class_attr_types[(self.cur_class(), target.id)] = parts
        elif (isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name) and sc.cls
              and target.value.id == sc.first_param):
            self.fi.class_attr_types[(sc.cls, target.attr)] = parts

    # -- definitions
    def visit_ClassDef(self, node):
        for d in node.decorator_list + node.bases + [k.value for k in node.keywords]:
            self.visit(d)
        q = self.qual(node.name)
        bases = [c for c in (chain(b) for b in node.bases) if c]
        self.fi.symbols[q] = {"kind": "class", "line": node.lineno, "end": node.end_lineno, "cls": self.cur_class(),
                              "bases": bases, "async": False}
        if self.scope.qname != "<module>":
            self.scope.nested[node.name] = q
        self.stack.append(("class", q))
        saved = self.in_class_body
        self.in_class_body = True
        for st in node.body:
            self.visit(st)
        self.in_class_body = saved
        self.stack.pop()

    def visit_FunctionDef(self, node):
        for d in node.decorator_list:
            self.visit(d)
        for d in node.args.defaults + [x for x in node.args.kw_defaults if x]:
            self.visit(d)
        q = self.qual(node.name)
        cls = self.cur_class()
        static = any(chain(d) and chain(d)[-1] == "staticmethod" for d in node.decorator_list)
        is_async = isinstance(node, ast.AsyncFunctionDef)
        self.fi.symbols[q] = {"kind": "method" if cls else "function", "line": node.lineno, "end": node.end_lineno,
                              "cls": cls, "bases": [], "async": is_async}
        if not cls and self.scope.qname != "<module>":
            self.scope.nested[node.name] = q
        a = node.args
        params = a.posonlyargs + a.args
        first = params[0].arg if cls and params and not static else None
        sc = Scope(q, parent=self.scope, cls=cls, first_param=first, is_async=is_async)
        sc.locals, sc.globals_decl = _local_names(node)
        for p in params + a.kwonlyargs:
            if p.arg != first:
                c = ann_chain(p.annotation)
                if c:
                    sc.types[p.arg] = c
        self.fi.scopes[q] = sc
        saved = (self.scope, self.in_class_body)
        self.scope, self.in_class_body = sc, False
        self.stack.append(("func", q))
        for st in node.body:
            self.visit(st)
        self.stack.pop()
        self.scope, self.in_class_body = saved

    visit_AsyncFunctionDef = visit_FunctionDef

    # -- imports
    def abs_module(self, level, module):
        if not level:
            return module or ""
        parts = self.fi.pkg.split(".") if self.fi.pkg else []
        if level - 1 > len(parts):
            return None
        base = parts[:len(parts) - (level - 1)]
        return ".".join(base + ([module] if module else []))

    def visit_Import(self, node):
        lazy = self.scope.qname != "<module>" or self.tc > 0
        names = []
        for al in node.names:
            if al.asname:
                self.scope.aliases[al.asname] = ("module", al.name)
            else:
                top = al.name.split(".")[0]
                self.scope.aliases[top] = ("module", top)
            names.append((al.name, None))
        self.fi.imports.append({"line": node.lineno, "lazy": lazy, "mod": None, "names": names})

    def visit_ImportFrom(self, node):
        lazy = self.scope.qname != "<module>" or self.tc > 0
        mod = self.abs_module(node.level, node.module)
        if mod is None:
            return
        names = []
        for al in node.names:
            if al.name == "*":
                continue
            self.scope.aliases[al.asname or al.name] = ("from", mod, al.name)
            names.append((al.name, al.asname))
        self.fi.imports.append({"line": node.lineno, "lazy": lazy, "mod": mod, "names": names})

    # -- statements
    def visit_If(self, node):
        if self.scope.qname == "<module>" and not self.stack and _is_main_test(node.test):
            self.fi.main_blocks.append(node.lineno)
        tc = _is_type_checking(node.test)
        self.visit(node.test)
        self.tc += tc
        for st in node.body:
            self.visit(st)
        self.tc -= tc
        for st in node.orelse:
            self.visit(st)

    def visit_Assign(self, node):
        self.visit(node.value)
        for t in node.targets:
            self.note_type(t, node.value)
            if self.in_class_body and isinstance(t, ast.Name):
                self.fi.class_attr_lines.setdefault((self.cur_class(), t.id), node.lineno)
            if self.scope.qname == "<module>" and not self.stack and isinstance(t, ast.Name):
                if t.id == "__all__" and isinstance(node.value, (ast.List, ast.Tuple)):
                    self.fi.all_names = [e.value for e in node.value.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)]
            self.visit(t)

    def visit_AnnAssign(self, node):
        if node.value is not None:
            self.visit(node.value)
        c = ann_chain(node.annotation)
        if c:
            self.record_type(node.target, c)
        elif node.value is not None:
            self.note_type(node.target, node.value)
        if self.in_class_body and isinstance(node.target, ast.Name):
            self.fi.class_attr_lines.setdefault((self.cur_class(), node.target.id), node.lineno)
        self.visit(node.target)

    def visit_AugAssign(self, node):
        self.visit(node.value)
        self.target = node.target
        self.visit(node.target)
        self.target = None

    # -- expressions
    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            self.add_name(node, "read")
        else:
            kind = "del" if isinstance(node.ctx, ast.Del) else ("augassign" if node is self.target else "assign")
            if self.scope.qname == "<module>" and not self.stack:
                self.fi.module_vars.setdefault(node.id, node.lineno)
            elif node.id in self.scope.globals_decl:
                self.fi.module_vars.setdefault(node.id, node.lineno)
            self.add_name(node, kind)

    def visit_Attribute(self, node):
        if isinstance(node.ctx, ast.Load):
            self.add_attr(node, "read")
        else:
            self.add_attr(node, "del" if isinstance(node.ctx, ast.Del) else ("augassign" if node is self.target else "assign"))
        self.generic_visit(node)

    def visit_Subscript(self, node):
        if isinstance(node.ctx, (ast.Store, ast.Del)):
            v = node.value
            if isinstance(v, ast.Attribute):
                self.add_attr(v, "item")
            elif isinstance(v, ast.Name):
                self.add_name(v, "item")
        self.generic_visit(node)

    def visit_Call(self, node):
        parts = chain(node.func)
        f = node.func
        sc = self.scope.qname
        if parts:
            if isinstance(f, ast.Attribute):
                jl, jc = f.end_lineno, f.end_col_offset - len(f.attr)
            else:
                jl, jc = f.lineno, f.col_offset
            self.fi.calls.append((tuple(parts), node.lineno, jl, jc, sc))
        if isinstance(f, ast.Attribute) and f.attr in MUTATORS:
            if isinstance(f.value, ast.Attribute):
                self.add_attr(f.value, "mutate")
            elif isinstance(f.value, ast.Name):
                self.add_name(f.value, "mutate")
        self.spawn(node, parts)
        self.generic_visit(node)

    def spawn(self, node, parts):
        """Records functions handed to threads, executors and asyncio tasks."""
        if not parts:
            return
        last = parts[-1]

        def target(arg):
            if isinstance(arg, ast.Call):
                arg = arg.func
            return chain(arg)

        found = []
        if last in THREAD_CTORS:
            kind, kw, pos = THREAD_CTORS[last]
            for k in node.keywords:
                if k.arg == kw:
                    found.append((kind, target(k.value)))
            if pos is not None and len(node.args) > pos:
                found.append((kind, target(node.args[pos])))
        elif last in EXECUTOR_CALLS and len(node.args) > EXECUTOR_CALLS[last]:
            found.append(("executor", target(node.args[EXECUTOR_CALLS[last]])))
        elif last in TASK_CALLS and node.args:
            found.append(("task", target(node.args[0])))
        for kind, t in found:
            if t:
                self.fi.spawns.append((kind, tuple(t), node.lineno, self.scope.qname))


def module_names(rel_path):
    """(dotted module name, package for relative imports, is __init__) from the package layout alone."""
    p = rel_path[:-3] if rel_path.endswith(".py") else rel_path
    parts = p.split("/")
    is_init = parts[-1] == "__init__"
    if is_init:
        parts = parts[:-1]
    return ".".join(parts), (".".join(parts) if is_init else ".".join(parts[:-1])), is_init


def build_file(root, path, mtime):
    """Parses one file into a FileInfo (raises on syntax errors; callers skip those files)."""
    lines, tree = parse(os.path.join(root, path))
    mod, pkg, is_init = module_names(path)
    fi = FileInfo(path, mod, pkg, is_init, mtime)
    fi.lines = len(lines)
    Indexer(fi).visit(tree)
    return fi


# ---- workspace index -----------------------------------------------------------------------

def is_test_path(path):
    base = path.rsplit("/", 1)[-1]
    return (base.startswith("test_") or base.endswith("_test.py") or base == "conftest.py"
            or any(p in ("test", "tests") for p in path.split("/")[:-1]))


def sym(path, q):
    return "%s#%s" % (path, q)


class Index:
    """Per-workspace file facts plus lazily derived cross-file graph."""

    def __init__(self, root):
        self.root = root
        self.files = {}
        self.errors = {}
        self.stamp = None
        self.reset()

    def reset(self):
        self.modmap, self.memo_mro, self.out, self.inn = {}, {}, {}, {}
        self.subs, self.targets, self.built = {}, {}, False

    # -- scanning
    def refresh(self):
        """Re-stats the workspace, re-parsing only changed files; drops derived data when anything changed."""
        seen, changed = {}, False
        count = 0
        for dp, dns, fns in os.walk(self.root):
            dns[:] = sorted(d for d in dns if d not in SKIP_DIRS and not d.startswith(".")
                            and not os.path.exists(os.path.join(dp, d, "pyvenv.cfg")))
            for fn in sorted(fns):
                if not fn.endswith(".py"):
                    continue
                count += 1
                if count > MAX_FILES:
                    break
                ap = os.path.join(dp, fn)
                path = rel(self.root, ap)
                try:
                    seen[path] = os.stat(ap).st_mtime_ns
                except OSError:
                    continue
        for path in list(self.files):
            if path not in seen:
                del self.files[path]
                changed = True
        for path in list(self.errors):
            if path not in seen:
                del self.errors[path]
        for path, mt in seen.items():
            old = self.files.get(path)
            if old and old.mtime == mt:
                continue
            if self.errors.get(path) == mt:
                continue
            changed = True
            try:
                self.files[path] = build_file(self.root, path, mt)
                self.errors.pop(path, None)
            except (ValueError, SyntaxError, UnicodeDecodeError, OSError):
                self.files.pop(path, None)
                self.errors[path] = mt
        if changed or self.stamp is None:
            self.reset()
            self.stamp = True

    # -- resolution
    def build(self):
        """Derives module map, class hierarchy and the call graph."""
        if self.built:
            return
        self.built = True
        for path, fi in sorted(self.files.items()):
            self.modmap.setdefault(fi.module, path)
        for path, fi in sorted(self.files.items()):
            for q, s in fi.symbols.items():
                if s["kind"] == "class":
                    for c in self.mro(("class", path, q))[0][1:]:
                        self.subs.setdefault(sym(c[1], c[2]), set()).add(sym(path, q))
        self.methods = {}
        for path, fi in self.files.items():
            for q, s in fi.symbols.items():
                if s["kind"] == "method":
                    self.methods.setdefault(q.rsplit(".", 1)[-1], []).append((path, q))
        self.jedi_left = JEDI_BUDGET
        for path, fi in sorted(self.files.items()):
            for parts, line, jl, jc, scn in fi.calls:
                self.add_call(fi, parts, line, jl, jc, scn)
            for kind, parts, line, scn in fi.spawns:
                ent = self.resolve_chain(fi, fi.scopes[scn], list(parts))
                t = self.func_sym(ent)
                if t:
                    self.add_edge(sym(path, scn), t, line, False, True)
                    self.targets.setdefault(t, (kind, sym(path, scn)))

    def add_edge(self, a, b, line, approx=False, spawn=False, candidates=None):
        if a == b:
            return
        info = {"line": line, "approx": approx, "spawn": spawn, "candidates": candidates}
        self.out.setdefault(a, {}).setdefault(b, info)
        self.inn.setdefault(b, {}).setdefault(a, info)

    def func_sym(self, ent):
        """Symbol a callable entity stands for (class -> its `__init__` on the MRO, else the class)."""
        if not ent:
            return None
        if ent[0] == "func":
            return sym(ent[1], ent[2])
        if ent[0] == "class":
            for c in self.mro(ent)[0]:
                if c[2] + ".__init__" in self.files[c[1]].symbols:
                    return sym(c[1], c[2] + ".__init__")
            return sym(ent[1], ent[2])
        return None

    def add_call(self, fi, parts, line, jl, jc, scn):
        sc = fi.scopes[scn]
        ent = self.resolve_chain(fi, sc, list(parts))
        caller = sym(fi.path, scn)
        t = self.func_sym(ent)
        if t:
            self.add_edge(caller, t, line)
            return
        if ent is not None or len(parts) < 2 or parts[-1].endswith("()"):
            return
        cands = self.methods.get(parts[-1], [])
        if len(cands) == 1:
            self.add_edge(caller, sym(*cands[0]), line, approx=True)
        elif len(cands) > 1:
            t = self.jedi_target(fi, jl, jc)
            if t:
                self.add_edge(caller, t, line, approx=True)
            else:  # no definite answer: every candidate, flagged with how many there were
                for c in sorted(cands)[:MAX_CANDIDATES]:
                    self.add_edge(caller, sym(*c), line, approx=True, candidates=len(cands))

    def jedi_target(self, fi, line, col):
        key = (line, col)
        if key in fi.jedi_cache:
            return fi.jedi_cache[key]
        if self.jedi_left <= 0:
            return None
        self.jedi_left -= 1
        res = None
        try:
            jedi, proj = _jedi(self.root)
            defs = jedi.Script(path=os.path.join(self.root, fi.path), project=proj).infer(line, col)
            defs = [d for d in defs if d.type == "function" and d.module_path]
            if len(defs) == 1:  # several definitions means jedi is unsure too
                d = defs[0]
                p = rel(self.root, str(d.module_path))
                f2 = self.files.get(p)
                for q, s in (f2.symbols.items() if f2 else ()):
                    if s["line"] == d.line and s["kind"] in ("method", "function"):
                        res = sym(p, q)
                        break
        except Exception:
            res = None
        fi.jedi_cache[(line, col)] = res
        return res

    def lookup_top(self, path, name, hops=0):
        fi = self.files[path]
        s = fi.symbols.get(name)
        if s and s["cls"] is None and "." not in name:
            return ("class" if s["kind"] == "class" else "func", path, name)
        al = fi.scopes["<module>"].aliases.get(name)
        if al:
            return self.alias_entity(al, hops)
        if name in fi.module_vars:
            return ("var", path, name)
        return None

    def alias_entity(self, al, hops=0):
        if hops > HOPS:
            return None
        if al[0] == "module":
            p = self.modmap.get(al[1])
            return ("module", p) if p else ("external",)
        _, mod, orig = al
        p = self.modmap.get(mod)
        if p:
            ent = self.lookup_top(p, orig, hops + 1)
            if ent:
                return ent
        sub = self.modmap.get(mod + "." + orig if mod else orig)
        if sub:
            return ("module", sub)
        return None if p else ("external",)

    def resolve_root(self, fi, sc, name, seen):
        s = sc
        while s is not None:
            if s.cls and name == s.first_param:
                return ("inst", ("class", fi.path, s.cls))
            if name in s.types:
                key = (fi.path, s.qname, name)
                if key in seen:
                    return ("local",)
                t = self.type_entity(fi, s, s.types[name], seen | {key})
                return t or ("local",)
            if name in s.aliases:
                return self.alias_entity(s.aliases[name])
            if name in s.nested:
                q = s.nested[name]
                return ("class" if fi.symbols[q]["kind"] == "class" else "func", fi.path, q)
            if name in s.locals:
                return ("local",)
            s = s.parent
        ent = self.lookup_top(fi.path, name)
        if ent:
            if ent[0] == "var":
                t = fi.scopes["<module>"].types.get(name)
                if t:
                    return self.type_entity(fi, fi.scopes["<module>"], t, seen | {(fi.path, "<module>", name)}) or ent
            return ent
        return ("external",) if name in BUILTIN_NAMES else None

    def type_entity(self, fi, sc, parts, seen):
        ent = self.resolve_chain(fi, sc, list(parts), seen)
        if ent and ent[0] == "class":
            return ("inst", ent)
        return ent if ent and ent[0] in ("inst", "external") else None

    def resolve_chain(self, fi, sc, parts, seen=frozenset()):
        first = parts[0]
        call = first.endswith("()")
        name = first[:-2] if call else first
        if call and name == "super" and sc and sc.cls:
            ent = ("super", ("class", fi.path, sc.cls))
        else:
            ent = self.resolve_root(fi, sc, name, seen)
            if call:
                ent = ("inst", ent) if ent and ent[0] == "class" else (ent if ent and ent[0] == "external" else None)
        for p in parts[1:]:
            if ent is None:
                return None
            callp = p.endswith("()")
            ent = self.step(ent, p[:-2] if callp else p, seen)
            if callp:
                ent = ("inst", ent) if ent and ent[0] == "class" else (ent if ent and ent[0] == "external" else None)
        return ent

    def mro(self, cls):
        """([class entities, self first], has_external_base) over resolvable workspace bases."""
        if cls in self.memo_mro:
            return self.memo_mro[cls]
        self.memo_mro[cls] = ([cls], False)  # cycle guard
        order, ext = [cls], False
        fi = self.files[cls[1]]
        msc = fi.scopes["<module>"]
        for b in fi.symbols[cls[2]]["bases"]:
            ent = self.resolve_chain(fi, msc, list(b))
            if ent and ent[0] == "class":
                sub, e = self.mro(ent)
                order += [c for c in sub if c not in order]
                ext = ext or e
            else:
                ext = True
        self.memo_mro[cls] = (order, ext)
        return order, ext

    def step(self, ent, a, seen):
        kind = ent[0]
        if kind == "module":
            fi = self.files[ent[1]]
            r = self.lookup_top(ent[1], a)
            if r:
                return r
            sub = self.modmap.get(fi.module + "." + a)
            return ("module", sub) if sub else None
        if kind in ("class", "inst", "super"):
            cls = ent[1] if kind != "class" else ent
            if kind == "inst" and cls[0] != "class":
                return None
            order, ext = self.mro(cls)
            if kind == "super":
                order = order[1:]
            for c in order:
                cfi = self.files[c[1]]
                q = c[2] + "." + a
                s = cfi.symbols.get(q)
                if s:
                    return ("class" if s["kind"] == "class" else "func", c[1], q)
                t = cfi.class_attr_types.get((c[2], a))
                if t:
                    r = self.type_entity(cfi, cfi.scopes["<module>"], t, seen)
                    if r:
                        return r
            return ("external",) if ext or kind == "super" else None
        if kind == "var":
            return None
        if kind == "func":
            return ("external",)
        return ent if kind == "external" else None


# ---- queries -------------------------------------------------------------------------------

_indexes = {}


def get_index(root):
    """Refreshed and built index of the workspace."""
    idx = _indexes.get(root)
    if idx is None:
        idx = _indexes[root] = Index(root)
    idx.refresh()
    idx.build()
    return idx


def parse_symbol(root, idx, params, key="symbol"):
    """(path, qualified name) of a `path#Name` argument, checked to exist in the index."""
    s = params.get(key)
    if not isinstance(s, str) or "#" not in s:
        raise ValueError("%s must be path#Name" % key)
    path, name = s.split("#", 1)
    if not is_python(path):
        unsupported(path)
    resolve(root, path)
    if path not in idx.files:
        if path in idx.errors:
            raise ValueError("syntax error in %s" % path)
        raise ValueError("no such file: %s" % path)
    return path, name


def known_symbol(idx, path, name):
    return name == "<module>" or name in idx.files[path].symbols


def kind_of(idx, s):
    path, q = s.split("#", 1)
    if q == "<module>":
        return "module"
    return idx.files[path].symbols[q]["kind"]


def seeds_of(idx, s):
    """Symbols standing for `s` in the graph: a class also stands for its `__init__`."""
    path, q = s.split("#", 1)
    out = [s]
    sy = idx.files[path].symbols.get(q)
    if sy and sy["kind"] == "class" and q + ".__init__" in idx.files[path].symbols:
        out.append(sym(path, q + ".__init__"))
    return out


def traverse(idx, seeds, directions, depth):
    """Breadth-first walk over call edges: ({sym: (depth, dir, info)}, {(from, to): info})."""
    nodes, edges = {}, {}
    for d in directions:
        adj = idx.inn if d == "in" else idx.out
        seen, frontier = set(seeds), list(seeds)
        for level in range(1, depth + 1):
            nxt = []
            for n in frontier:
                for m, info in sorted(adj.get(n, {}).items()):
                    edges.setdefault((m, n) if d == "in" else (n, m), info)
                    if m not in seen:
                        seen.add(m)
                        nxt.append(m)
                        if m not in nodes:
                            nodes[m] = (level, d, info)
            frontier = nxt
    for s in seeds:
        nodes.pop(s, None)
    return nodes, edges


def edge_item(a, b, info):
    e = {"from": a, "to": b, "line": info["line"]}
    if info["approx"]:
        e["approx"] = True
    if info["spawn"]:
        e["spawn"] = True
    if info.get("candidates"):
        e["candidates"] = info["candidates"]
    return e


def call_graph(root, params):
    idx = get_index(root)
    path, name = parse_symbol(root, idx, params)
    if not known_symbol(idx, path, name):
        raise ValueError("symbol not found: %s" % params["symbol"])
    direction = params.get("direction") or "both"
    if direction not in ("in", "out", "both"):
        raise ValueError("direction must be in, out or both")
    depth = max(1, min(int(params.get("depth") or 2), MAX_DEPTH))
    start = params["symbol"]
    nodes, edges = traverse(idx, seeds_of(idx, start), ("in", "out") if direction == "both" else (direction,), depth)
    nl = []
    for s, (d, dr, _) in sorted(nodes.items(), key=lambda kv: (kv[1][0], kv[0])):
        n = {"symbol": s, "depth": d, "kind": kind_of(idx, s)}
        if direction == "both":
            n["dir"] = dr
        nl.append(n)
    el = [edge_item(a, b, i) for (a, b), i in sorted(edges.items())]
    return {"symbol": start, "direction": direction, "depth": depth, "nodes": nl, "edges": el}


# ---- imports -------------------------------------------------------------------------------

def import_edges(idx):
    """{(from path, to path): {line, lazy}} between workspace modules (cached until files change)."""
    if getattr(idx, "iedges", None) is not None:
        return idx.iedges
    edges = {}
    for path, fi in sorted(idx.files.items()):
        for imp in fi.imports:
            targets = []
            if imp["mod"] is None:
                targets = [idx.modmap.get(n) for n, _ in imp["names"]]
            else:
                base = idx.modmap.get(imp["mod"])
                if not imp["names"]:
                    targets = [base]
                for n, _ in imp["names"]:
                    sub = idx.modmap.get(imp["mod"] + "." + n if imp["mod"] else n)
                    defined = base and (n in idx.files[base].symbols or n in idx.files[base].module_vars)
                    targets.append(sub if sub and not defined else base)
            for t in targets:
                if not t or t == path:
                    continue
                old = edges.get((path, t))
                new = {"line": imp["line"], "lazy": imp["lazy"]}
                if old is None or (old["lazy"] and not new["lazy"]):
                    edges[(path, t)] = new
    idx.iedges = edges
    return edges


def find_cycles(edges):
    """Cycles over non-lazy import edges: one per DFS back edge, with the importing line that closes it."""
    adj = {}
    for (a, b), info in edges.items():
        if not info["lazy"]:
            adj.setdefault(a, []).append(b)
    for a in adj:
        adj[a].sort()
    state, cycles = {}, []
    for start in sorted(adj):
        if state.get(start):
            continue
        stack, iters, pos = [start], [iter(adj[start])], {start: 0}
        state[start] = 1
        while stack:
            u = stack[-1]
            for v in iters[-1]:
                if state.get(v) == 1:
                    cycles.append({"modules": stack[pos[v]:], "closedBy": {"path": u, "line": edges[(u, v)]["line"]}})
                elif not state.get(v):
                    state[v] = 1
                    pos[v] = len(stack)
                    stack.append(v)
                    iters.append(iter(adj.get(v, [])))
                    break
            else:
                state[u] = 2
                stack.pop()
                iters.pop()
                del pos[u]
    return cycles


def module_set(idx, spec):
    """Paths named by `spec`: a file, a dotted module/package name, or a package directory."""
    spec = spec.strip().rstrip("/")
    ext = os.path.splitext(spec)[1].lstrip(".").lower()
    if "/" in spec or ext in FILE_EXTS:
        if ext and not is_python(spec):
            unsupported(spec)
        if spec in idx.files:
            return {spec}
        pre = spec + "/"
        hit = {p for p in idx.files if p.startswith(pre)}
        if hit:
            return hit
    elif spec in idx.modmap:
        hit = {idx.modmap[spec]}
        pre = spec + "."
        return hit | {p for m, p in idx.modmap.items() if m.startswith(pre)}
    else:
        pre = spec + "."
        hit = {p for m, p in idx.modmap.items() if m.startswith(pre)}
        if hit:
            return hit
    raise ValueError("module not found: %s" % spec)


def import_graph(root, params):
    idx = get_index(root)
    edges = import_edges(idx)
    cycles = find_cycles(edges)
    spec = params.get("module")
    if spec:
        sel = module_set(idx, spec)
        edges = {k: v for k, v in edges.items() if k[0] in sel or k[1] in sel}
        cycles = [c for c in cycles if sel & set(c["modules"])]
    el = []
    for (a, b), info in sorted(edges.items()):
        e = {"from": a, "to": b, "line": info["line"]}
        if info["lazy"]:
            e["lazy"] = True
        el.append(e)
    return {"module": spec, "edges": el, "cycles": cycles}


# ---- impact --------------------------------------------------------------------------------

def impact(root, params):
    idx = get_index(root)
    path, name = parse_symbol(root, idx, params)
    if name == "<module>" or name not in idx.files[path].symbols:
        raise ValueError("symbol not found: %s" % params["symbol"])
    start = params["symbol"]
    depth = max(1, min(int(params.get("depth") or 4), 8))
    sy = idx.files[path].symbols[name]
    seeds = seeds_of(idx, start)
    subclasses, overrides = [], []
    if sy["kind"] == "class":
        subclasses = sorted(idx.subs.get(start, ()))
    elif sy["kind"] == "method":
        cls = ("class", path, sy["cls"])
        mname = name.rsplit(".", 1)[1]
        for c in idx.mro(cls)[0][1:]:  # callers of what this method overrides dispatch here too
            q = c[2] + "." + mname
            if q in idx.files[c[1]].symbols:
                seeds.append(sym(c[1], q))
        for sub in sorted(idx.subs.get(sym(path, sy["cls"]), ())):
            sp, sq = sub.split("#", 1)
            if sq + "." + mname in idx.files[sp].symbols:
                overrides.append(sym(sp, sq + "." + mname))
    nodes, _ = traverse(idx, seeds, ("in",), depth)
    callers, tests, seen_tests = [], [], set()
    for s, (d, _, info) in sorted(nodes.items(), key=lambda kv: (kv[1][0], kv[0])):
        p = s.split("#", 1)[0]
        if is_test_path(p):
            tests.append({"path": p, "symbol": s, "depth": d, "via": "call"})
            seen_tests.add(p)
        else:
            c = {"symbol": s, "depth": d, "line": info["line"]}
            if info["approx"]:
                c["approx"] = True
            callers.append(c)
    for (a, b), _ in sorted(import_edges(idx).items()):
        if b == path and is_test_path(a) and a not in seen_tests:
            tests.append({"path": a, "via": "import"})
    return {"symbol": start, "callers": callers, "subclasses": subclasses, "overrides": overrides, "tests": tests}


# ---- dataFlow ------------------------------------------------------------------------------

WRITE_KINDS = {"assign", "augassign", "item", "mutate", "del", "declare"}
CTX_LABEL = {"thread": "thread target", "executor": "executor task", "task": "asyncio task"}


def reach(idx):
    """{symbol: (kind, target)} for functions reachable (<= 6 calls) from a thread/task target."""
    if getattr(idx, "reach_map", None) is not None:
        return idx.reach_map
    out = {}
    for t, (kind, _) in sorted(idx.targets.items()):
        frontier, seen = [t], {t}
        for _ in range(6):
            nxt = []
            for n in frontier:
                for m, info in idx.out.get(n, {}).items():
                    if not info["spawn"] and m not in seen:
                        seen.add(m)
                        nxt.append(m)
                        out.setdefault(m, (kind, t))
            frontier = nxt
    idx.reach_map = out
    return out


def context_of(idx, path, scn):
    """Why code in this scope may run concurrently, or None."""
    s = sym(path, scn)
    if s in idx.targets:
        return CTX_LABEL[idx.targets[s][0]]
    if scn != "<module>" and idx.files[path].symbols[scn]["async"]:
        return "async def"
    r = reach(idx).get(s)
    if r:
        return "reachable from %s %s" % (CTX_LABEL[r[0]], r[1])
    return None


def class_ent(ent):
    if ent and ent[0] == "inst":
        ent = ent[1]
    return ent if ent and ent[0] == "class" else None


def collect(idx, hits, key):
    """Splits (path, line, col, scope, kind, approx) hits into sorted writes and reads."""
    wpos = {(p, l, c) for p, l, c, _, k, _ in hits if k in WRITE_KINDS}
    writes, reads, seen = [], [], set()
    for p, l, c, scn, k, approx in sorted(hits, key=lambda h: (h[5], h[0], h[1], h[2])):
        if (p, l, c, k) in seen:
            continue
        seen.add((p, l, c, k))
        item = {"path": p, "line": l, "col": c, "in": sym(p, scn), "kind": k}
        if approx:
            item["approx"] = True
        if k in WRITE_KINDS:
            ctx = context_of(idx, p, scn)
            if ctx:
                item["context"] = ctx
            writes.append(item)
        elif (p, l, c) not in wpos:
            reads.append(item)
    return writes, reads


def data_flow(root, params):
    idx = get_index(root)
    path, name = parse_symbol(root, idx, params)
    fi = idx.files[path]
    hits = []
    if "." in name:
        cq, attr = name.rsplit(".", 1)
        cs = fi.symbols.get(cq)
        if not cs or cs["kind"] != "class":
            raise ValueError("symbol not found: %s" % params["symbol"])
        target = ("class", path, cq)
        family = {target}
        for s in idx.subs.get(sym(path, cq), ()):
            sp, sq = s.split("#", 1)
            family.add(("class", sp, sq))
        for f2 in idx.files.values():
            for (cq2, a), line in f2.class_attr_lines.items():
                if a == attr and ("class", f2.path, cq2) in family:
                    hits.append((f2.path, line, 1, cq2, "declare", False))
            for base, a, kind, line, col, scn in f2.attrs:
                if a != attr:
                    continue
                ent = idx.resolve_chain(f2, f2.scopes[scn], list(base))
                ce = class_ent(ent)
                if ce is not None:
                    if target in idx.mro(ce)[0]:
                        hits.append((f2.path, line, col, scn, kind, False))
                elif ent is None or ent[0] == "local":
                    hits.append((f2.path, line, col, scn, kind, True))
        known = hits or (cq, attr) in fi.class_attr_types
    else:
        if name in fi.symbols:
            raise ValueError("%s is a %s: dataFlow takes a variable or attribute" % (params["symbol"], fi.symbols[name]["kind"]))
        if name not in fi.module_vars:
            raise ValueError("symbol not found: %s" % params["symbol"])
        target = ("var", path, name)
        for f2 in idx.files.values():
            cand = {name} if f2.path == path else {an for sc in f2.scopes.values() for an, al in sc.aliases.items()
                                                    if al[0] == "from" and al[2] == name}
            for n, kind, line, col, scn in f2.names:
                if n not in cand:
                    continue
                sc = f2.scopes[scn]
                if kind in ("assign", "augassign", "del") and not (f2.path == path and (scn == "<module>" or n in sc.globals_decl)):
                    continue
                if idx.resolve_root(f2, sc, n, frozenset()) == target:
                    hits.append((f2.path, line, col, scn, kind, False))
            for imp in f2.imports:
                if imp["mod"] is not None and idx.modmap.get(imp["mod"]) == path and any(n == name for n, _ in imp["names"]):
                    hits.append((f2.path, imp["line"], 1, "<module>", "import", False))
            for base, a, kind, line, col, scn in f2.attrs:
                if a == name and idx.resolve_chain(f2, f2.scopes[scn], list(base)) == ("module", path):
                    hits.append((f2.path, line, col, scn, kind, False))
        known = True
    if not hits and not known:
        raise ValueError("attribute not found: %s" % params["symbol"])
    writes, reads = collect(idx, hits, name)
    return {"symbol": params["symbol"], "writes": writes, "reads": reads,
            "concurrentWrites": sum(1 for w in writes if "context" in w)}


# ---- overview ------------------------------------------------------------------------------

def console_scripts(root, idx):
    """Entry points declared in pyproject.toml (`[project.scripts]` / `[tool.poetry.scripts]`)."""
    out = []
    pp = os.path.join(root, "pyproject.toml")
    if not os.path.isfile(pp):
        return out
    try:
        import tomllib
        with open(pp, "rb") as f:
            data = tomllib.load(f)
    except Exception:
        return out
    tables = [data.get("project", {}).get("scripts", {}), data.get("project", {}).get("gui-scripts", {}),
              data.get("tool", {}).get("poetry", {}).get("scripts", {})]
    for t in tables:
        for sname, target in sorted(t.items()):
            if not isinstance(target, str):
                continue
            mod, _, fn = target.partition(":")
            p = idx.modmap.get(mod.strip())
            e = {"kind": "script", "name": sname}
            if p:
                e["path"] = p
                fn = fn.strip()
                if fn and fn in idx.files[p].symbols:
                    e["symbol"] = sym(p, fn)
                    e["line"] = idx.files[p].symbols[fn]["line"]
            else:
                e["target"] = target
            out.append(e)
    return out


def overview(root, params):
    idx = get_index(root)
    edges = import_edges(idx)
    imports, imported_by = {}, {}
    for (a, b) in edges:
        imports[a] = imports.get(a, 0) + 1
        imported_by[b] = imported_by.get(b, 0) + 1
    mods, api, tests = [], [], []
    for path, fi in sorted(idx.files.items()):
        top = [q for q, s in fi.symbols.items() if "." not in q]
        item = {"path": path, "symbols": len(fi.symbols), "imports": imports.get(path, 0), "importedBy": imported_by.get(path, 0)}
        if is_test_path(path):
            tests.append({"path": path, "tests": sum(1 for q in fi.symbols if q.rsplit(".", 1)[-1].startswith("test")),
                          "imports": sorted(b for (a, b) in edges if a == path)})
            continue
        mods.append(item)
        if fi.all_names is not None:
            names, via = fi.all_names, "__all__"
        else:
            names, via = [q for q in top if not q.startswith("_") and fi.symbols[q]["kind"] != "method"], "top-level"
        if names and path.rsplit("/", 1)[-1] != "__main__.py":
            api.append({"path": path, "via": via, "names": names[:10], "more": max(0, len(names) - 10)})
    mods.sort(key=lambda m: (-m["importedBy"], m["path"]))
    api.sort(key=lambda m: (-imported_by.get(m["path"], 0), m["path"]))
    entries = []
    for path, fi in sorted(idx.files.items()):
        for line in fi.main_blocks:
            entries.append({"kind": "main", "path": path, "line": line})
    entries += console_scripts(root, idx)
    sized = []
    degree = []
    for path, fi in idx.files.items():
        if is_test_path(path):
            continue
        for q, s in fi.symbols.items():
            sized.append((s["end"] - s["line"] + 1, sym(path, q)))
            sy = sym(path, q)
            n = len(set(idx.out.get(sy, {})) | set(idx.inn.get(sy, {})))
            if n:
                degree.append((n, sy, len(idx.inn.get(sy, {})), len(idx.out.get(sy, {}))))
    sized.sort(key=lambda t: (-t[0], t[1]))
    degree.sort(key=lambda t: (-t[0], t[1]))
    return {"modules": mods, "entryPoints": entries, "publicApi": api,
            "largest": [{"symbol": s, "lines": n} for n, s in sized[:8]],
            "mostConnected": [{"symbol": s, "callers": i, "callees": o} for _, s, i, o in degree[:8]],
            "tests": tests, "unparsed": sorted(idx.errors)}


METHODS = {
    "overview": overview,
    "callGraph": call_graph,
    "importGraph": import_graph,
    "impact": impact,
    "dataFlow": data_flow,
}
