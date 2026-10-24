import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolCtx } from "../src/index.ts";

const repoVenv = fileURLToPath(new URL("../.venv", import.meta.url));

/** The venv to run the sidecar from: `AIW_VENV`, else the repo dev venv, else the default; undefined when none exists. */
export function findVenv(): string | undefined {
  const cands = [process.env.AIW_VENV, repoVenv, "/opt/aiw/venv"].filter((x): x is string => !!x);
  return cands.find((v) => existsSync(`${v}/bin/python`));
}

/** Test env with `AIW_VENV` pointing at the found venv. */
export function venvEnv(): NodeJS.ProcessEnv {
  return { ...process.env, AIW_VENV: findVenv() };
}

/** Reason for `t.skip`, or undefined when the venv exists. */
export const skipReason: string | undefined = findVenv() ? undefined : "no tool venv (run `npm run setup:venv` in packages/tools or set AIW_VENV)";

/** Writes files (root-relative path to text) into a fresh temp dir and returns its realpath. */
export function makeWorkspace(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aiw-py-")));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

export const ctxOf = (root: string, signal: AbortSignal = new AbortController().signal): ToolCtx => ({ root, signal });

/** Small multi-module Python package used by the nav tests. */
export const PKG: Record<string, string> = {
  "pkg/__init__.py": "from .util import slugify\n",
  "pkg/util.py": [
    '"""Utilities."""',
    'DEFAULT_SEP = "-"',
    "",
    "def slugify(text: str, sep: str = DEFAULT_SEP) -> str:",
    '    """Make a slug."""',
    "    return sep.join(text.lower().split())",
    "",
  ].join("\n"),
  "pkg/models.py": [
    "from .util import slugify",
    "",
    "class Base:",
    '    """Base class."""',
    "",
    "class User(Base):",
    '    """A user."""',
    "    def __init__(self, name: str) -> None:",
    "        self.name = name",
    "",
    "    @property",
    "    def slug(self) -> str:",
    "        return slugify(self.name)",
    "",
    "    async def save(self) -> None:",
    '        """Persist."""',
    "        print(slugify(self.name))",
    "",
  ].join("\n"),
  "pkg/views.py": [
    "from pkg.models import User",
    "from pkg.util import slugify",
    "",
    "def show(u: User) -> str:",
    "    return slugify(u.name)",
    "",
  ].join("\n"),
  "README.md": "# Title\n\ntext\n\n```\n# not a heading\n```\n\n## Usage\n",
  "config.json": '{\n  "name": "x",\n  "items": [1, 2],\n  "nested": {"a": 1}\n}\n',
  "settings.yaml": "name: demo\nitems:\n  - a\n  - b\ndebug: true\n",
  "app.ts": "export const a = 1;\n",
};

/** Package for the graph tests: call chain, import cycle (core <-> helpers), override, thread-target write, test file. */
export const GRAPH_PKG: Record<string, string> = {
  "pyproject.toml": '[project]\nname = "app"\n\n[project.scripts]\napp-cli = "app.core:main"\n',
  "app/__init__.py": "from .core import run\n\n__all__ = [\"run\"]\n",
  "app/core.py": [
    "from app import helpers",
    "from app.store import Store",
    "",
    "LIMIT = 10",
    "",
    "def run(n):",
    "    store = Store()",
    "    return helpers.step(store, n)",
    "",
    "def main():",
    "    print(run(1))",
    "",
    'if __name__ == "__main__":',
    "    main()",
    "",
  ].join("\n"),
  "app/helpers.py": [
    "from app.core import LIMIT",
    "import threading",
    "from app.store import Store",
    "",
    "TOTAL = 0",
    "",
    "def step(s: Store, n):",
    "    s.flush()",
    "    return n + LIMIT",
    "",
    "def worker(s: Store):",
    "    global TOTAL",
    "    TOTAL += 1",
    "    s.count = 5",
    "",
    "def start(s: Store):",
    "    t = threading.Thread(target=worker, args=(s,))",
    "    t.start()",
    "",
    "async def tick(s: Store):",
    "    s.count += 1",
    "",
    "def peek(s: Store):",
    "    return s.count + TOTAL",
    "",
  ].join("\n"),
  "app/store.py": [
    "class Base:",
    "    def save(self):",
    "        raise NotImplementedError",
    "",
    "class Store(Base):",
    "    def __init__(self):",
    "        self.items = []",
    "        self.count = 0",
    "",
    "    def save(self):",
    "        self.count += 1",
    "        self.items.append(1)",
    "",
    "    def flush(self):",
    "        self.save()",
    "",
  ].join("\n"),
  "app/extra.py": [
    "from app.store import Store",
    "",
    "class FastStore(Store):",
    "    def save(self):",
    "        super().save()",
    "        self.count = 0",
    "",
  ].join("\n"),
  "tests/test_core.py": [
    "from app.core import run",
    "",
    "def test_run():",
    "    assert run(1) == 11",
    "",
  ].join("\n"),
  "app/ui.js": "export const x = 1;\n",
};

/** Multi-module package for the refactor tests: re-export, cross-module use, a calc module and messy imports. */
export const REFACTOR_PKG: Record<string, string> = {
  "pkg/__init__.py": "from .util import slugify\n",
  "pkg/util.py": [
    'DEFAULT_SEP = "-"',
    "",
    "def slugify(text: str, sep: str = DEFAULT_SEP) -> str:",
    '    """Make a slug."""',
    "    return sep.join(text.lower().split())",
    "",
    "def shout(t):",
    "    return t.upper()",
    "",
    "def double(x):",
    "    return x * 2",
    "",
  ].join("\n"),
  "pkg/models.py": [
    "from .util import slugify",
    "",
    "class User:",
    "    def __init__(self, name: str) -> None:",
    "        self.name = name",
    "",
    "    def slug(self) -> str:",
    "        return slugify(self.name)",
    "",
  ].join("\n"),
  "pkg/views.py": [
    "from pkg.models import User",
    "from pkg.util import double, shout, slugify",
    "",
    "def show(u: User) -> str:",
    '    return slugify(u.name, sep="_")',
    "",
    "def loud(u: User) -> str:",
    "    return shout(u.name)",
    "",
    "def twice(n):",
    "    return double(n)",
    "",
    "def raw(obj):",
    "    return obj.name",
    "",
  ].join("\n"),
  "pkg/calc.py": [
    "import math",
    "",
    "def total(items, rate):",
    "    s = 0",
    "    for i in items:",
    "        s += i * 2",
    "    t = s * rate",
    "    return t + math.floor(s)",
    "",
    "def day_seconds(x):",
    "    return x + 3600 * 24",
    "",
    "class Acc:",
    "    def add(self, x, y):",
    "        z = x + y",
    "        w = z * 2",
    "        return w",
    "",
  ].join("\n"),
  "pkg/messy.py": [
    '"""Messy imports."""',
    "import sys",
    "import os, json",
    "import unused_mod",
    "from pkg.util import shout",
    "",
    "def a(x):",
    "    import re",
    "    import math",
    "    import requests",
    '    return re.sub("a", "b", x) + str(math.pi)',
    "",
    "def b():",
    "    import os",
    "    return os.getcwd(), json.dumps({})",
    "",
    "def only():",
    "    import string",
    "",
  ].join("\n"),
  "notes.txt": "plain text\n",
};
