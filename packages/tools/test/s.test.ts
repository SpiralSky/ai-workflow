import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { bash, edit, findFiles, grep, readFile, toolEnv, writeFile, type ToolCtx } from "../src/index.ts";
import { filesJS, filesRg, grepJS, grepRg, hasRg } from "../src/search.ts";

let root: string;
let outside: string;
const ctx = (extra: Partial<ToolCtx> = {}): ToolCtx => ({ root, signal: new AbortController().signal, ...extra });

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "aiw-tools-")));
  outside = realpathSync(mkdtempSync(join(tmpdir(), "aiw-out-")));
  writeFileSync(join(outside, "secret.txt"), "x");
  mkdirSync(join(root, "src/sub"), { recursive: true });
  mkdirSync(join(root, "node_modules/m"), { recursive: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, "src/a.py"), "def foo():\n    return 1\n\ndef Bar():\n    return foo()\n");
  writeFileSync(join(root, "src/sub/b.py"), "# TODO foo\nx = 2\n");
  writeFileSync(join(root, "src/c.txt"), "hello foo\n");
  writeFileSync(join(root, "top.py"), "FOO = 1\n");
  writeFileSync(join(root, ".hidden"), "foo hidden\n");
  writeFileSync(join(root, "node_modules/m/x.py"), "foo\n");
  writeFileSync(join(root, ".git/config"), "foo\n");
  writeFileSync(join(root, "bin.dat"), Buffer.from([102, 111, 111, 0, 1, 2]));
  symlinkSync(outside, join(root, "link"));
});
after(() => {});

test("path escape rejected", async () => {
  for (const p of ["../x", outside + "/secret.txt", "link/secret.txt", "link/new/file.txt", "src/../../x"]) {
    await assert.rejects(readFile.fn({ path: p }, ctx()), new RegExp(`path outside workspace: ${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
  await assert.rejects(writeFile.fn({ path: "link/new.txt", content: "x" }, ctx()), /path outside workspace/);
  assert.equal(existsSync(join(outside, "new.txt")), false);
});

test("writeFile creates dirs and reports change; overwrite diff", async () => {
  const r1: any = await writeFile.fn({ path: "d/e/new.txt", content: "a\nb\n" }, ctx());
  assert.deepEqual(r1.files, [{ path: "d/e/new.txt", added: 2, removed: 0 }]);
  assert.ok(r1.diff.includes("+a"));
  const r2: any = await writeFile.fn({ path: "d/e/new.txt", content: "a\nc\nd\n" }, ctx());
  assert.deepEqual(r2.files, [{ path: "d/e/new.txt", added: 2, removed: 1 }]);
  assert.ok(r2.diff.includes("-b") && r2.diff.includes(" a"));
  const big: any = await writeFile.fn({ path: "big.txt", content: "line\n".repeat(2000) }, ctx());
  assert.equal(big.files[0].added, 2000);
  assert.equal(big.diff, undefined);
});

test("edit: unique, not found, all", async () => {
  writeFileSync(join(root, "ed.txt"), "one two\none three\n");
  await assert.rejects(edit.fn({ path: "ed.txt", old: "zzz", new: "y" }, ctx()), /not found/);
  await assert.rejects(edit.fn({ path: "ed.txt", old: "one", new: "1" }, ctx()), /not unique \(2 matches\); add context or pass all: true/);
  const r: any = await edit.fn({ path: "ed.txt", old: "one two", new: "$& 2" }, ctx());
  assert.deepEqual(r.files, [{ path: "ed.txt", added: 1, removed: 1 }]);
  assert.equal(readFileSync(join(root, "ed.txt"), "utf8"), "$& 2\none three\n");
  await edit.fn({ path: "ed.txt", old: "e", new: "E", all: true }, ctx());
  assert.equal(readFileSync(join(root, "ed.txt"), "utf8"), "$& 2\nonE thrEE\n".replace("2", "2"));
});

test("readFile: numbering, range, truncation", async () => {
  const out = await readFile.fn({ path: "src/a.py", range: [2, 3] }, ctx());
  assert.equal(out, "     2\t    return 1\n     3\t");
  writeFileSync(join(root, "long.txt"), Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
  const t = (await readFile.fn({ path: "long.txt" }, ctx())) as string;
  assert.ok(Buffer.byteLength(t) < 8300);
  assert.match(t, /\[truncated at line \d+ of 3000; pass range to read more\]$/);
  const part = (await readFile.fn({ path: "long.txt", range: [2990, 5000] }, ctx())) as string;
  assert.ok(part.endsWith("line 3000") && !part.includes("truncated"));
  await assert.rejects(readFile.fn({ path: "src/a.py", range: [9, 3] }, ctx()), /invalid range/);
});

test("bash: output, exit code, cwd", async () => {
  const r: any = await bash.fn({ cmd: "echo out; echo err >&2; pwd; exit 3" }, ctx());
  assert.equal(r.code, 3);
  assert.ok(r.out.includes("out") && r.out.includes("err") && r.out.includes(root));
});

test("bash: timeout kills the process group", async () => {
  const pidFile = join(root, "child.pid");
  const t0 = Date.now();
  const r: any = await bash.fn({ cmd: `sleep 30 & echo $! > ${pidFile}; wait`, timeoutMs: 1500 }, ctx());
  assert.equal(r.code, 124);
  assert.match(r.out, /timed out after 1500 ms/);
  assert.ok(Date.now() - t0 < 5000);
  await new Promise((r) => setTimeout(r, 100));
  const pid = Number(readFileSync(pidFile, "utf8"));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});

test("bash: abort kills the child", async () => {
  const ac = new AbortController();
  const pidFile = join(root, "child2.pid");
  const p: any = bash.fn({ cmd: `sleep 30 & echo $! > ${pidFile}; wait` }, ctx({ signal: ac.signal }));
  for (let i = 0; i < 100 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 50));
  ac.abort();
  const r = await p;
  assert.equal(r.code, 130);
  await new Promise((r) => setTimeout(r, 100));
  assert.throws(() => process.kill(Number(readFileSync(pidFile, "utf8")), 0), /ESRCH/);
});

test("bash: secrets stripped from env", async () => {
  const env = { ...process.env, OPENAI_API_KEY: "s1", ANTHROPIC_API_KEY: "s2", OPENROUTER_API_KEY: "s3", MY_TOKEN: "s4", AIW_SECRET_NAMES: "MY_TOKEN, OTHER", KEEP_ME: "ok" };
  const r: any = await bash.fn({ cmd: 'echo "[$OPENAI_API_KEY$ANTHROPIC_API_KEY$OPENROUTER_API_KEY$MY_TOKEN][$KEEP_ME]"' }, ctx({ env }));
  assert.equal(r.out.trim(), "[][ok]");
  assert.equal(toolEnv(env).MY_TOKEN, undefined);
  assert.equal(env.MY_TOKEN, "s4"); // base untouched
});

const EXPECT_GREP = [
  { path: "src/a.py", line: 1, text: "def foo():" },
  { path: "src/a.py", line: 5, text: "    return foo()" },
  { path: "src/c.txt", line: 1, text: "hello foo" },
  { path: "src/sub/b.py", line: 1, text: "# TODO foo" },
  { path: ".hidden", line: 1, text: "foo hidden" },
].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));

test("grep: rg and JS fallback agree", async (t) => {
  const js = grepJS(root, root, "foo", undefined, false);
  assert.deepEqual(js, EXPECT_GREP);
  if (!hasRg()) return t.skip("rg not installed");
  assert.deepEqual(await grepRg(root, "foo", ".", undefined, false), js);
  assert.deepEqual(await grepRg(root, "FOO", "src", "*.py", true), grepJS(root, join(root, "src"), "FOO", "*.py", true));
  assert.deepEqual(await grepRg(root, "foo", "src", "sub/*.py", false), grepJS(root, join(root, "src"), "foo", "sub/*.py", false));
});

test("grep tool: filters, truncation", async () => {
  const r: any = await grep.fn({ pattern: "foo", path: "src", glob: "*.py" }, ctx());
  assert.deepEqual(r.matches.map((m: any) => `${m.path}:${m.line}`), ["src/a.py:1", "src/a.py:5", "src/sub/b.py:1"]);
  assert.equal(r.truncated, undefined);
  const one: any = await grep.fn({ pattern: "foo", maxResults: 2 }, ctx());
  assert.equal(one.matches.length, 2);
  assert.match(one.truncated, /showing 2 of 5; /);
  const f: any = await grep.fn({ pattern: "foo", path: "src/c.txt" }, ctx());
  assert.deepEqual(f.matches, [{ path: "src/c.txt", line: 1, text: "hello foo" }]);
  await assert.rejects(grep.fn({ pattern: "foo", path: "../" }, ctx()), /path outside workspace/);
});

test("findFiles: rg and JS agree, sorted, truncation", async (t) => {
  const js = filesJS(root, root, "*.py");
  assert.deepEqual(js, ["src/a.py", "src/sub/b.py", "top.py"]);
  assert.deepEqual(filesJS(root, root, "src/**/*.py"), ["src/a.py", "src/sub/b.py"]);
  if (hasRg()) {
    assert.deepEqual(await filesRg(root, "*.py", "."), js);
    assert.deepEqual(await filesRg(root, "src/**/*.py", "."), filesJS(root, root, "src/**/*.py"));
    assert.deepEqual(await filesRg(root, "*.py", "src"), filesJS(root, join(root, "src"), "*.py"));
  } else t.diagnostic("rg not installed");
  const r: any = await findFiles.fn({ pattern: "*.py", path: "src" }, ctx());
  assert.deepEqual(r.files, ["src/a.py", "src/sub/b.py"]);
  mkdirSync(join(root, "many"));
  for (let i = 0; i < 250; i++) writeFileSync(join(root, "many", `f${String(i).padStart(3, "0")}.m`), "");
  const m: any = await findFiles.fn({ pattern: "*.m" }, ctx());
  assert.equal(m.files.length, 200);
  assert.match(m.truncated, /showing 200 of 250/);
});
