import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createChatGPTAuth } from '../src/chatgpt-auth.ts';

/** Offline rotating-token service. Reusing a consumed refresh token is terminal. */
async function setup(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'aiw-refresh-mock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'test' };
  let now = Date.now(), epoch = 0, attempt: any;
  let jwksUnavailable = false, invalidIdentity = false, invalidSignature = false;
  let missingReplacement = false, rejectedRefresh = false;
  let onKeys: (() => void) | undefined, onRefresh: (() => void | Promise<void>) | undefined, onNow: (() => void) | undefined;
  const calls: string[] = [];
  const fetcher = (async (input: any, init: RequestInit = {}) => {
    const url = String(input); calls.push(url);
    assert.equal(init.redirect, 'error');
    init.signal?.throwIfAborted();
    if (url.endsWith('/jwks.json')) {
      onKeys?.();
      if (jwksUnavailable) return new Response('', { status: 503 });
      return Response.json({ keys: [jwk] });
    }
    assert.equal(url, 'https://auth.openai.com/api/accounts/oauth/token');
    const body = new URLSearchParams(String(init.body));
    if (body.get('grant_type') === 'refresh_token') {
      if (rejectedRefresh || body.get('refresh_token') !== `test-refresh-${epoch}`) {
        return Response.json({ error: 'refresh_token_reused' }, { status: 400 });
      }
      epoch++;
      await onRefresh?.();
      // Unlike an abort-ignoring mock, this enforces the actual transport's abort contract.
      init.signal?.throwIfAborted();
    }
    const idToken = await new SignJWT({ nonce: attempt.nonce })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer('https://auth.openai.com').setAudience('oaiapp_mock')
      .setSubject(invalidIdentity ? 'another-subject' : 'test-subject')
      .setIssuedAt(Math.floor(now / 1000)).setExpirationTime(Math.floor(now / 1000) + 3600)
      .sign(privateKey);
    return Response.json({ access_token: `test-access-${epoch}`,
      ...(missingReplacement ? {} : { refresh_token: `test-refresh-${epoch}` }),
      id_token: invalidSignature ? `${idToken.slice(0, -5)}AAAAA` : idToken,
      token_type: 'Bearer', expires_in: 3600,
      scope: 'openid offline_access resource.invoke chatgpt.tokens.use.direct' });
  }) as typeof fetch;
  const clock = () => { onNow?.(); return now; };
  const auth = createChatGPTAuth({ directory, fetch: fetcher, now: clock });
  attempt = await auth.beginSignIn('http://127.0.0.1:54321/auth/callback');
  const account = await auth.finishSignIn(attempt,
    `${attempt.redirectURI}?state=${attempt.state}&code=test-code&client_id=oaiapp_mock`);
  now += 3_600_000;
  calls.length = 0;
  return {
    auth, account, calls, directory,
    another: () => createChatGPTAuth({ directory, fetch: fetcher, now: clock }),
    epoch: () => epoch,
    read: async () => JSON.parse(await readFile(join(directory, `${account.accountId}.json`), 'utf8')),
    set: (values: { jwksUnavailable?: boolean; invalidIdentity?: boolean; invalidSignature?: boolean;
      missingReplacement?: boolean; rejectedRefresh?: boolean; onKeys?: () => void;
      onRefresh?: () => void | Promise<void>; onNow?: () => void; advance?: number }) => {
      jwksUnavailable = values.jwksUnavailable ?? jwksUnavailable;
      invalidIdentity = values.invalidIdentity ?? invalidIdentity;
      invalidSignature = values.invalidSignature ?? invalidSignature;
      missingReplacement = values.missingReplacement ?? missingReplacement;
      rejectedRefresh = values.rejectedRefresh ?? rejectedRefresh;
      onKeys = values.onKeys ?? onKeys; onRefresh = values.onRefresh ?? onRefresh;
      onNow = values.onNow ?? onNow;
      now += values.advance ?? 0;
    },
  };
}

test('JWKS failure happens before rotating refresh and the saved session remains usable', async t => {
  const s = await setup(t); s.set({ jwksUnavailable: true });
  await assert.rejects(s.auth.getAccessToken(s.account.accountId));
  assert.equal(s.epoch(), 0);
  assert.deepEqual(s.calls, ['https://auth.openai.com/.well-known/jwks.json']);
  assert.equal((await s.read()).refreshToken, 'test-refresh-0');
  s.set({ jwksUnavailable: false });
  assert.equal(await s.auth.getAccessToken(s.account.accountId), 'test-access-1');
  assert.equal((await s.read()).refreshToken, 'test-refresh-1');
});

test('cancellation during refresh persists the validated rotation but does not return a token', async t => {
  const s = await setup(t), abort = new AbortController();
  s.set({ onRefresh: () => abort.abort() });
  await assert.rejects(s.auth.getAccessToken(s.account.accountId, abort.signal), { name: 'AbortError' });
  assert.equal(s.epoch(), 1);
  assert.equal((await s.read()).refreshToken, 'test-refresh-1');
  assert.deepEqual(s.calls, ['https://auth.openai.com/.well-known/jwks.json', 'https://auth.openai.com/api/accounts/oauth/token']);
  assert.equal(await s.another().getAccessToken(s.account.accountId), 'test-access-1');
  assert.equal(s.epoch(), 1, 'a later process must not refresh or reuse the consumed token');
});

test('cancellation after verification-key preflight does not consume a refresh token', async t => {
  const s = await setup(t), abort = new AbortController();
  s.set({ onKeys: () => abort.abort() });
  await assert.rejects(s.auth.getAccessToken(s.account.accountId, abort.signal), { name: 'AbortError' });
  assert.equal(s.epoch(), 0);
  assert.equal(s.calls.length, 1);
  assert.equal((await s.read()).refreshToken, 'test-refresh-0');
});

test('an already-cancelled caller does no credential-service work', async t => {
  const s = await setup(t), abort = new AbortController(); abort.abort();
  await assert.rejects(s.auth.getAccessToken(s.account.accountId, abort.signal), { name: 'AbortError' });
  assert.deepEqual(s.calls, []); assert.equal(s.epoch(), 0);
});

test('cancellation during a cached-token read is checked after releasing the lock', async t => {
  const s = await setup(t), abort = new AbortController();
  await s.auth.getAccessToken(s.account.accountId);
  const previousCalls = s.calls.length;
  s.set({ onNow: () => abort.abort() });
  await assert.rejects(s.auth.getAccessToken(s.account.accountId, abort.signal), { name: 'AbortError' });
  assert.equal(s.calls.length, previousCalls);
});

test('a concurrent caller waits for a cancelled caller to durably finish rotation', async t => {
  const s = await setup(t), abort = new AbortController();
  let started!: () => void, release!: () => void;
  const dispatched = new Promise<void>(resolve => { started = resolve; });
  const proceed = new Promise<void>(resolve => { release = resolve; });
  s.set({ onRefresh: async () => { started(); await proceed; } });
  const first = assert.rejects(s.auth.getAccessToken(s.account.accountId, abort.signal), { name: 'AbortError' });
  await dispatched;
  const second = s.another().getAccessToken(s.account.accountId);
  abort.abort(); release();
  await first;
  assert.equal(await second, 'test-access-1');
  assert.equal(s.epoch(), 1);
  assert.equal((await s.read()).refreshToken, 'test-refresh-1');
});

test('another process uses the committed replacement after cancelled refresh', { timeout: 10_000 }, async t => {
  const s = await setup(t), abort = new AbortController();
  let started!: () => void, release!: () => void;
  const dispatched = new Promise<void>(resolve => { started = resolve; });
  const proceed = new Promise<void>(resolve => { release = resolve; });
  s.set({ onRefresh: async () => { started(); await proceed; } });
  const first = assert.rejects(s.auth.getAccessToken(s.account.accountId, abort.signal), { name: 'AbortError' });
  await dispatched;
  const script = `
    import { createChatGPTAuth } from ${JSON.stringify(new URL('../src/chatgpt-auth.ts', import.meta.url).href)};
    const auth = createChatGPTAuth({ directory: ${JSON.stringify(s.directory)}, fetch: async () => { throw new Error('Child must reuse the committed token'); } });
    process.stdout.write('started\\n');
    if (await auth.getAccessToken(${JSON.stringify(s.account.accountId)}) !== 'test-access-1') throw new Error('Wrong token generation');
    process.stdout.write('complete\\n');
  `;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { release(); child.kill(); });
  let output = '', errors = '', ready!: () => void;
  const childStarted = new Promise<void>(resolve => { ready = resolve; });
  child.stdout.on('data', chunk => { output += chunk; if (output.includes('started\n')) ready(); });
  child.stderr.on('data', chunk => { errors += chunk; });
  const finished = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Child failed (${code}): ${errors}`)));
  });
  await Promise.race([childStarted, finished.then(() => { throw new Error('Child exited before starting'); })]);
  abort.abort(); release();
  await Promise.all([first, finished]);
  assert.equal(output, 'started\ncomplete\n');
  assert.equal(s.epoch(), 1);
});

for (const mutation of ['invalidIdentity', 'invalidSignature', 'missingReplacement', 'rejectedRefresh'] as const) {
  test(`refresh ${mutation} still cannot replace validated account credentials`, async t => {
    const s = await setup(t), original = await s.read();
    s.set({ [mutation]: true });
    await assert.rejects(s.auth.getAccessToken(s.account.accountId));
    assert.deepEqual(await s.read(), original);
  });
}
