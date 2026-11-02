import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PROBLEM_DOCKERIGNORE } from '../src/build-context.ts';

/** Synthetic local context; Docker remains a fake command boundary. */
function context(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'aiw-context-'));
  writeFileSync(join(dir, '.dockerignore'), PROBLEM_DOCKERIGNORE);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
import { buildImage, startContainer, problemImageRef, type DockerImageCommand } from '../src/container.ts';

import { gradingContainerArgs } from '../src/grade.ts';

const id = `sha256:${'a'.repeat(64)}`;
const digest = `registry.example/test@sha256:${'b'.repeat(64)}`;

/** Provide inspection data while recording the real production command arguments. */
function fakeDocker(stdout: string) {
  const calls: string[][] = [];
  const run: DockerImageCommand = async (command, args) => {
    assert.equal(command, 'docker');
    calls.push(args);
    return { stdout: args[0] === 'image' ? stdout : '' };
  };
  return { calls, run };
}

test('local build uses immutable configuration ID when RepoDigests is empty', async t => {
    const dir = context(t);
  const { run, calls } = fakeDocker(JSON.stringify([{ Id: id, RepoDigests: [] }]));
  assert.equal(await buildImage(dir, 'smoke', run), id);
  assert.deepEqual(calls, [['build', '-t', 'aiw-problem:smoke', dir],
    ['image', 'inspect', 'aiw-problem:smoke']]);
});

test('registry-backed image retains repository manifest digest', async t => {
    const dir = context(t);
  const { run } = fakeDocker(JSON.stringify([{ Id: id, RepoDigests: [digest] }]));
  assert.equal(await buildImage(dir, 'smoke', run), digest);
});

for (const [name, value] of Object.entries({
  'missing Id': [{ RepoDigests: [] }],
  'mutable tag Id': [{ Id: 'aiw-problem:smoke', RepoDigests: [] }],
  'short hash': [{ Id: 'sha256:abc', RepoDigests: [] }],
  'missing RepoDigests': [{ Id: id }],
  'non-array RepoDigests': [{ Id: id, RepoDigests: digest }],
  'malformed manifest digest': [{ Id: id, RepoDigests: ['repo:latest'] }],
  'empty inspection': [],
  'multiple images': [{ Id: id, RepoDigests: [] }, { Id: id, RepoDigests: [] }],
  'non-object image': ['bad'],
  'non-array inspection': { Id: id, RepoDigests: [] },
})) {
  test(`rejects ${name}; never returns mutable tag fallback`, async t => {
    const dir = context(t);
    const { run } = fakeDocker(JSON.stringify(value));
    await assert.rejects(buildImage(dir, 'smoke', run));
  });
}

test('malformed inspection JSON fails closed', async t => {
    const dir = context(t);
  await assert.rejects(buildImage(dir, 'smoke', fakeDocker('{').run), SyntaxError);
});

for (const failure of ['build', 'image']) {
  test(`${failure} command failure propagates without retry or fallback`, async t => {
    const dir = context(t);
    const calls: string[] = [];
    const error = new Error(`${failure} failed`);
    const run: DockerImageCommand = async (_command, args) => {
      calls.push(args[0]);
      if (args[0] === failure) throw error;
      return { stdout: '' };
    };
    await assert.rejects(buildImage(dir, 'smoke', run), actual => actual === error);
    assert.deepEqual(calls, failure === 'build' ? ['build'] : ['build', 'image']);
  });
}

for (const task of ['01-chunk-off-by-one', 'L1-rename-sku', 'L2-split-pricing',
  'L3-import-cycle', 'L4-currency-param', 'L5-refund-double-count']) {
  test(`build, candidate run, and grading use the same case-preserving image: ${task}`, async t => {
    const dir = context(t);
    const ref = `aiw-problem:${task}`;
    const { run, calls } = fakeDocker(JSON.stringify([{ Id: id, RepoDigests: [] }]));
    await buildImage(dir, task, run);
    const ctr = await startContainer(task, '/out', '/bundle', undefined, run);
    assert.equal(problemImageRef(task), ref);
    assert.equal(calls[0][2], ref);
    assert.equal(calls[1][2], ref);
    assert.ok(calls[2].includes(ref));
    assert.equal(ctr.problem, task);
    assert.deepEqual(gradingContainerArgs(task), ['run', '-d', '--network', 'none', ref, 'sleep', 'infinity']);
  });
}

test('case-distinct task IDs cannot collide; valid maximum tag length retained', () => {
  assert.notEqual(problemImageRef('L1-rename-sku'), problemImageRef('l1-rename-sku'));
  assert.equal(problemImageRef('A'.repeat(128)), `aiw-problem:${'A'.repeat(128)}`);
});

for (const bad of ['', '../task', '/task', 'task/path', 'task\\path', '--privileged',
  '.hidden', 'name:tag', 'name@digest', 'task space', 'task\n', 'A'.repeat(129)]) {
  test(`unsafe/invalid task ID rejected before Docker: ${JSON.stringify(bad)}`, async t => {
    const dir = context(t);
    const { run, calls } = fakeDocker('');
    assert.throws(() => problemImageRef(bad), /Invalid problem ID/);
    assert.throws(() => gradingContainerArgs(bad), /Invalid problem ID/);
    await assert.rejects(buildImage(dir, bad, run), /Invalid problem ID/);
    await assert.rejects(startContainer(bad, '/out', '/bundle', undefined, run), /Invalid problem ID/);
    assert.deepEqual(calls, []);
  });
}

test('grading prefers the observed immutable image and rejects mutable references', () => {
  assert.deepEqual(gradingContainerArgs('L1-rename-sku', id), ['run', '-d', '--network', 'none', id, 'sleep', 'infinity']);
  assert.throws(() => gradingContainerArgs('L1-rename-sku', 'aiw-problem:L1-rename-sku'), /immutable/);
});
