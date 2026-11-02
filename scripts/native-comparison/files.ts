import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { readStableHandle } from '../dot-native/method.ts';

/** Reject every symlink component. Coordinator-owned paths are still required. */
export async function plainPath(path: string): Promise<void> {
  const absolute = resolve(path); let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('symlink path rejected');
  }
}

/** Read stable bounded UTF-8 without following links or accepting special files. */
export async function readText(path: string, max = 1_048_576): Promise<string> {
  await plainPath(path);
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(max)) throw new Error('invalid regular file');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const text = await readStableHandle({ stat: () => file.stat({ bigint: true }),
      read: (b, o, l, p) => file.read(b, o, l, p) }, before, max);
    const after = await lstat(path, { bigint: true });
    for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink', 'mode'] as const) {
      if (before[key] !== after[key]) throw new Error('path changed during read');
    }
    return text;
  } finally { await file.close(); }
}

/** Exclusive output creation; never replace evidence from an earlier attempt. */
export async function writeNew(path: string, text: string): Promise<void> {
  await plainPath(dirname(path));
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(text, 'utf8'); } finally { await file.close(); }
}

/** Create missing directory components privately, rejecting files and symlinks. */
export async function ensureRoot(root: string): Promise<void> {
  const absolute = resolve(root); let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    try { await mkdir(current, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const st = await lstat(current);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('invalid directory component');
  }
}

/** Run identifiers are names, never artifact-controlled filesystem paths. */
export function runPath(root: string, id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) throw new Error('invalid run id');
  return join(resolve(root), id);
}

/** Validate the canonical existing campaign before reserving an attempt. */
export async function existingRun(root: string, id: string): Promise<string> {
  const path = runPath(root, id); await plainPath(path);
  if (await realpath(path) !== path || !(await lstat(path)).isDirectory()) throw new Error('invalid run directory');
  return path;
}
