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
