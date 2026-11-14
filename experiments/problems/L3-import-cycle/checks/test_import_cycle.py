"""Check the requested import constraints and preserve the visible contract."""
import ast
import os
from pathlib import Path
import subprocess
import sys
import unittest


def source_graph():
    """Resolve relative and absolute imports between fulfil source modules."""
    modules = {}
    for path in Path("fulfil").rglob("*.py"):
        parts = list(path.with_suffix("").parts)
        package = parts[-1] == "__init__"
        if package:
            parts.pop()
        modules[".".join(parts)] = (path, package)
    graph = {name: set() for name in modules}
    for name, (path, package) in modules.items():
        parent = name.split(".") if package else name.split(".")[:-1]
        for node in ast.walk(ast.parse(path.read_text())):
            targets = []
            if isinstance(node, ast.Import):
                targets = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    prefix = parent[:len(parent) - node.level + 1]
                    target = ".".join(prefix + ((node.module or "").split(".") if node.module else []))
                else:
                    target = node.module or ""
                targets = [target] + [target + "." + alias.name for alias in node.names]
            graph[name].update(target for target in targets if target in modules)
    return graph


class ImportCycleTests(unittest.TestCase):
    def test_every_module_imports_in_fresh_interpreter(self):
        for name in sorted(source_graph()):
            with self.subTest(module=name):
                result = subprocess.run([sys.executable, "-B", "-c", "import " + name],
                                        capture_output=True, text=True, timeout=5,
                                        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_no_function_local_imports(self):
        for path in Path("fulfil").rglob("*.py"):
            tree = ast.parse(path.read_text())
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    for child in ast.walk(node):
                        self.assertNotIsInstance(child, (ast.Import, ast.ImportFrom),
                                                 str(path) + ":" + str(getattr(child, "lineno", node.lineno)))

    def test_no_source_import_cycle(self):
        graph = source_graph()
        done, visiting = set(), set()
        def visit(name):
            self.assertNotIn(name, visiting, "import cycle at " + name)
            if name in done:
                return
            visiting.add(name)
            for dependency in graph[name]:
                visit(dependency)
            visiting.remove(name)
            done.add(name)
        for name in graph:
            visit(name)
