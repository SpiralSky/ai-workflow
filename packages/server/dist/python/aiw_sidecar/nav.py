"""Navigation methods: outline, readSymbol (ast) and findDefinition, findReferences, signature (jedi)."""
import ast
import json
import os
import re

from .common import SKIP_DIRS, is_python, lang, rel, resolve, unsupported

MAX_SOURCE_BYTES = 8000
MAX_REFS = 500

_ast_cache = {}  # abs path -> (mtime_ns, lines, tree)
_projects = {}  # root -> jedi.Project


def parse(abs_path):
    """(lines, tree) of a Python file, cached by (path, mtime)."""
    mtime = os.stat(abs_path).st_mtime_ns
    hit = _ast_cache.get(abs_path)
    if hit and hit[0] == mtime:
        return hit[1], hit[2]
    with open(abs_path, encoding="utf-8") as f:
        text = f.read()
    try:
        tree = ast.parse(text)
    except SyntaxError as e:
        raise ValueError("syntax error at line %s: %s" % (e.lineno, e.msg))
    lines = text.splitlines()
    _ast_cache[abs_path] = (mtime, lines, tree)
    return lines, tree


def _text(abs_path):
    if not os.path.isfile(abs_path):
        raise ValueError("no such file: %s" % os.path.basename(abs_path))
    with open(abs_path, encoding="utf-8") as f:
        return f.read()


# ---- outline -------------------------------------------------------------------------------

def _sig(node):
    kw = "async def" if isinstance(node, ast.AsyncFunctionDef) else "def"
    ret = " -> " + ast.unparse(node.returns) if node.returns else ""
    return "%s %s(%s)%s" % (kw, node.name, ast.unparse(node.args), ret)


def _py_items(tree, path, prefix=""):
    items = []
    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            bases = "(%s)" % ", ".join(ast.unparse(b) for b in node.bases) if node.bases else ""
            q = prefix + node.name
            items.append({"kind": "class", "symbol": "%s#%s" % (path, q), "signature": "class %s%s" % (node.name, bases),
                          "line": node.lineno, "endLine": node.end_lineno})
            items.extend(_py_items(ast.Module(body=node.body, type_ignores=[]), path, q + "."))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            q = prefix + node.name
            items.append({"kind": "method" if prefix else "function", "symbol": "%s#%s" % (path, q),
                          "signature": _sig(node), "line": node.lineno, "endLine": node.end_lineno})
        elif isinstance(node, (ast.Assign, ast.AnnAssign)) and not prefix:
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for t in targets:
                if isinstance(t, ast.Name) and t.id.isupper():
                    items.append({"kind": "constant", "symbol": "%s#%s" % (path, t.id), "signature": t.id,
                                  "line": node.lineno, "endLine": node.end_lineno})
    return items


def _md_items(text, path):
    items, fence = [], False
    for i, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith(("```", "~~~")):
            fence = not fence
        m = None if fence else re.match(r"^(#{1,6})\s+(.*?)\s*#*\s*$", line)
        if m:
            items.append({"kind": "heading", "symbol": "%s#%s" % (path, m.group(2)), "signature": m.group(1) + " " + m.group(2), "line": i})
    for a, b in zip(items, items[1:] + [None]):
        a["endLine"] = (b["line"] - 1) if b else len(text.splitlines())
    return items


def _json_items(text, path):
    data = json.loads(text)
    if not isinstance(data, dict):
        return []
    lines = text.splitlines()
    items, start = [], 0
    for key, val in data.items():
        pat = json.dumps(key)
        line = next((i for i in range(start, len(lines)) if pat in lines[i]), start)
        start = line
        items.append({"kind": "key", "symbol": "%s#%s" % (path, key), "signature": "%s: %s" % (key, type(val).__name__), "line": line + 1})
    return items


def _yaml_items(text, path):
    items = []
    for i, line in enumerate(text.splitlines(), 1):
        m = re.match(r"^([A-Za-z0-9_.\-]+|\"[^\"]+\"|'[^']+'):(\s|$)", line)
        if m:
            key = m.group(1).strip("\"'")
            items.append({"kind": "key", "symbol": "%s#%s" % (path, key), "signature": key, "line": i})
    return items


def outline(root, p):
    path = p["path"]
    abs_path = resolve(root, path)
    kind = lang(path)
    if kind in ("py", "pyi"):
        _lines, tree = parse(abs_path)
        items = _py_items(tree, path)
    elif kind in ("md", "markdown"):
        items = _md_items(_text(abs_path), path)
    elif kind == "json":
        items = _json_items(_text(abs_path), path)
    elif kind in ("yaml", "yml"):
        items = _yaml_items(_text(abs_path), path)
    else:
        unsupported(path)
    return {"path": path, "items": items}


# ---- readSymbol ----------------------------------------------------------------------------

def split_symbol(symbol):
    if "#" not in symbol:
        raise ValueError("symbol must look like path#Name: %s" % symbol)
    path, name = symbol.split("#", 1)
    return path, name


def find_node(tree, qualified):
    """The ClassDef/FunctionDef/Assign node for `A.b` (module-level constants by plain name)."""
    body, node = tree.body, None
    for part in qualified.split("."):
        node = None
        for n in body:
            if isinstance(n, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == part:
                node = n
            elif isinstance(n, (ast.Assign, ast.AnnAssign)):
                ts = n.targets if isinstance(n, ast.Assign) else [n.target]
                if any(isinstance(t, ast.Name) and t.id == part for t in ts):
                    node = n
            if node is not None:
                break
        if node is None:
            raise ValueError("symbol not found: %s" % qualified)
        body = getattr(node, "body", [])
    return node


def read_symbol(root, p):
    path, name = split_symbol(p["symbol"])
    if not is_python(path):
        unsupported(path)
    lines, tree = parse(resolve(root, path))
    node = find_node(tree, name)
    if p.get("docOnly"):
        return {"symbol": p["symbol"], "doc": ast.get_docstring(node) if hasattr(node, "body") and not isinstance(node, (ast.Assign, ast.AnnAssign)) else None}
    start = min([node.lineno] + [d.lineno for d in getattr(node, "decorator_list", [])])
    src = "\n".join(lines[start - 1:node.end_lineno])
    res = {"symbol": p["symbol"], "path": path, "line": start, "endLine": node.end_lineno}
    if len(src.encode()) > MAX_SOURCE_BYTES:
        src = src.encode()[:MAX_SOURCE_BYTES].decode(errors="ignore")
        src = src[:src.rfind("\n")] if "\n" in src else src
        res["truncated"] = "source cut at %d bytes; use readFile with range for the rest" % MAX_SOURCE_BYTES
    res["source"] = src
    return res


# ---- jedi-based ----------------------------------------------------------------------------

def _jedi(root):
    import jedi
    proj = _projects.get(root)
    if proj is None:
        proj = _projects[root] = jedi.Project(path=root)
    return jedi, proj


def _name_col(line_text, name, start=0):
    m = re.compile(r"\b%s\b" % re.escape(name)).search(line_text, start)
    return m.start() if m else None


def target(root, p):
    """(rel path, abs path, line, col0) of the position a nav query points at."""
    if p.get("symbol"):
        path, qualified = split_symbol(p["symbol"])
        if not is_python(path):
            unsupported(path)
        abs_path = resolve(root, path)
        lines, tree = parse(abs_path)
        node = find_node(tree, qualified)
        last = qualified.split(".")[-1]
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            col = _name_col(lines[node.lineno - 1], last)
        else:
            line_no = node.lineno
            col = _name_col(lines[line_no - 1], last, node.col_offset)
        return path, abs_path, node.lineno, col or 0
    path = p.get("path")
    if not path:
        raise ValueError("give symbol, or path with name or line+col")
    if not is_python(path):
        unsupported(path)
    abs_path = resolve(root, path)
    lines, _ = parse(abs_path)
    name, line, col = p.get("name"), p.get("line"), p.get("col")
    if name:
        last = name.split(".")[-1]
        cands = [line] if line else range(1, len(lines) + 1)
        for ln in cands:
            if not 1 <= ln <= len(lines):
                raise ValueError("line out of range: %s" % ln)
            c = _name_col(lines[ln - 1], last)
            if c is not None:
                return path, abs_path, ln, c
        raise ValueError("name not found in %s: %s" % (path, name))
    if line:
        if not 1 <= line <= len(lines):
            raise ValueError("line out of range: %s" % line)
        text = lines[line - 1]
        c = (col - 1) if col else len(text) - len(text.lstrip())
        return path, abs_path, line, c
    raise ValueError("give symbol, or path with name or line+col")


def _qualified(d):
    full, mod = d.full_name, d.module_name
    if full and mod and full.startswith(mod + "."):
        return full[len(mod) + 1:]
    return d.name


def _loc(root, d):
    """Location dict of a jedi Name; external (non-workspace) definitions carry only `module`."""
    out = {"name": d.name, "kind": d.type}
    p = str(d.module_path) if d.module_path else None
    r = rel(root, p) if p else None
    if r and not set(r.split("/")) & SKIP_DIRS:
        out.update(path=r, symbol="%s#%s" % (r, _qualified(d)))
        if d.line is not None:
            out.update(line=d.line, col=d.column + 1)
    else:
        out["module"] = d.module_name
    return out


def _script(root, abs_path):
    jedi, proj = _jedi(root)
    return jedi.Script(path=abs_path, project=proj)


def find_definition(root, p):
    path, abs_path, line, col = target(root, p)
    defs = _script(root, abs_path).goto(line, col, follow_imports=True, follow_builtin_imports=True)
    return {"definitions": [_loc(root, d) for d in defs]}


def find_references(root, p):
    path, abs_path, line, col = target(root, p)
    refs = _script(root, abs_path).get_references(line, col, include_builtins=False)
    out, cache = [], {}
    for r in refs:
        loc = _loc(root, r)
        if "path" not in loc:
            continue
        lines = cache.get(loc["path"])
        if lines is None:
            lines = cache[loc["path"]] = _text(os.path.join(root, loc["path"])).splitlines()
        ctx = lines[r.line - 1].strip() if r.line and r.line <= len(lines) else ""
        out.append({"path": loc["path"], "line": r.line, "col": r.column + 1, "context": ctx[:160],
                    **({"definition": True} if r.is_definition() else {})})
    out.sort(key=lambda x: (x["path"], x["line"], x["col"]))
    res = {"references": out[:MAX_REFS]}
    if len(out) > MAX_REFS:
        res["truncated"] = "showing %d of %d" % (MAX_REFS, len(out))
    return res


def signature(root, p):
    path, abs_path, line, col = target(root, p)
    script = _script(root, abs_path)
    defs = script.goto(line, col, follow_imports=True, follow_builtin_imports=True)
    if not defs:
        raise ValueError("no definition found")
    d = defs[0]
    res = _loc(root, d)
    sigs = d.get_signatures()
    res["signature"] = sigs[0].to_string() if sigs else (d.description or d.name)
    doc = d.docstring(raw=True)
    res["docstring"] = doc or None
    types = []
    for t in script.infer(line, col):
        h = t.get_type_hint() or t.name
        if h and h not in types:
            types.append(h)
    res["types"] = types
    return res


METHODS = {
    "outline": outline,
    "readSymbol": read_symbol,
    "findDefinition": find_definition,
    "findReferences": find_references,
    "signature": signature,
}
