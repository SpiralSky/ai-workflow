import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, stat, readFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createChatGPTAuth, ChatGPTSignInRestartRequired } from '../src/chatgpt-auth.ts';

async function setup(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'aiw-auth-mock-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const { publicKey, privateKey } = await generateKeyPair('RS256'); const jwk = { ...await exportJWK(publicKey), kid: 'test' };
  let attempt: any; let subject = 'mock-subject'; let issuer = 'https://auth.openai.com'; let audience = 'oaiapp_mock'; let nonceOverride: string | undefined; let scopes = 'openid offline_access resource.invoke chatgpt.tokens.use.direct'; let refreshes = 0; let time = Date.now(); let lifetime = 3600; let leakError = false; let expired = false; let omitRefresh = false; let tamper = false; let onToken: (() => void) | undefined; let invalidGrant = false;
  const calls: Array<{url: string; init: RequestInit}> = [];
  const fetcher = (async (input: any, init: RequestInit = {}) => {
    const url = String(input); calls.push({ url, init }); assert.equal(init.redirect, 'error');
    if (leakError) throw new Error('SECRET_ACCESS_MUST_NOT_LEAK');
    if (url.endsWith('/jwks.json')) return Response.json({ keys: [jwk] });
    if (url.endsWith('/openid-configuration')) return Response.json({ issuer: 'https://auth.openai.com', revocation_endpoint: 'https://evil.example/revoke' });
    assert.equal(url, 'https://auth.openai.com/api/accounts/oauth/token');
    if (invalidGrant) return Response.json({ error: 'invalid_grant', error_description: 'SECRET_MUST_NOT_LEAK' }, { status: 400 });
    const body = new URLSearchParams(String(init.body));
    const refreshing = body.get('grant_type') === 'refresh_token'; if (refreshing) refreshes++;
    const idToken = await new SignJWT({ nonce: nonceOverride ?? attempt.nonce }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(issuer).setAudience(audience).setSubject(subject).setIssuedAt(Math.floor(time / 1000)).setExpirationTime(Math.floor(time / 1000) + (expired ? -1 : 3600)).sign(privateKey);
    onToken?.();
    return Response.json({ access_token: `mock-access-${refreshes}`, ...(omitRefresh ? {} : { refresh_token: `mock-refresh-${refreshes}` }), id_token: tamper ? `${idToken.slice(0, -5)}AAAAA` : idToken, token_type: 'Bearer', expires_in: lifetime, scope: scopes });
  }) as typeof fetch;
  const auth = createChatGPTAuth({ directory, fetch: fetcher, now: () => time });
  async function begin(id?: string) { attempt = await auth.beginSignIn('http://127.0.0.1:54321/auth/callback', id); return attempt; }
  function callback(extra = '') { return `${attempt.redirectURI}?state=${attempt.state}&code=mock-code&client_id=oaiapp_mock${extra}`; }
  return { auth, anotherAuth: () => createChatGPTAuth({ directory, fetch: fetcher, now: () => time }), directory, calls, begin, callback, refreshes: () => refreshes, set: (values: any) => { subject = values.subject ?? subject; issuer = values.issuer ?? issuer; audience = values.audience ?? audience; nonceOverride = values.nonce; scopes = values.scopes ?? scopes; lifetime = values.lifetime ?? lifetime; time += values.advance ?? 0; leakError = values.leakError ?? leakError; expired = values.expired ?? expired; omitRefresh = values.omitRefresh ?? omitRefresh; tamper = values.tamper ?? tamper; onToken = values.onToken ?? onToken; invalidGrant = values.invalidGrant ?? invalidGrant; if (values.attempt) attempt = values.attempt; } };
}

test('mock authorization uses PKCE, stable host, exact public endpoints and atomic owner-only account storage', async t => {
  const s = await setup(t); const attempt = await s.begin(); const url = new URL(attempt.authorizationURL);
  assert.equal(url.origin, 'https://auth.openai.com'); assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.ok(!url.searchParams.has('id_token_hint'));
  const account = await s.auth.finishSignIn(attempt, s.callback()); assert.equal(account.signedIn, true);
  assert.equal((await s.auth.listAccounts()).length, 1); assert.equal(await s.auth.getAccessToken(account.accountId), 'mock-access-0');
  const again = await s.begin(account.accountId); assert.equal(again.hostId, attempt.hostId); assert.equal(new URL(again.authorizationURL).searchParams.get('client_id'), 'oaiapp_mock'); assert.ok(!new URL(again.authorizationURL).searchParams.has('agent_name_hint'));
  for (const file of await readdir(s.directory)) assert.equal((await stat(join(s.directory, file))).mode & 0o777, 0o600);
  await assert.rejects(s.auth.finishSignIn(attempt, s.callback()), /already used/);
});
test('state, callback origin, duplicate fields and returning registration changes rejected before exchange', async t => {
  const s = await setup(t); const a = await s.begin();
  await assert.rejects(s.auth.finishSignIn(a, s.callback().replace(a.state, 'bad')), /state/);
  await assert.rejects(s.auth.finishSignIn(a, s.callback().replace('127.0.0.1', 'localhost')), /URI/);
  await assert.rejects(s.auth.finishSignIn(a, s.callback('&state=second')), /duplicate/); assert.equal(s.calls.length, 0);
  const account = await s.auth.finishSignIn(a, s.callback()); const b = await s.begin(account.accountId); const before = s.calls.length;
  await assert.rejects(s.auth.finishSignIn(b, s.callback().replace('oaiapp_mock', 'oaiapp_other')), /client ID/); assert.equal(s.calls.length, before);
});
for (const [name, mutation] of Object.entries({ nonce: { nonce: 'wrong' }, issuer: { issuer: 'https://evil.example' }, audience: { audience: 'other' }, permission: { scopes: 'openid profile' }, expiration: { expired: true }, signature: { tamper: true } })) test(`invalid ${name} cannot save credentials`, async t => {
  const s = await setup(t); const a = await s.begin(); s.set(mutation); await assert.rejects(s.auth.finishSignIn(a, s.callback())); assert.deepEqual(await s.auth.listAccounts(), []);
});
test('refreshes serialize, rotate together, and sign-out rejects untrusted discovery endpoint', async t => {
  const s = await setup(t); const a = await s.begin(); const account = await s.auth.finishSignIn(a, s.callback()); s.set({ advance: 3_600_000 });
  assert.deepEqual(await Promise.all([s.auth.getAccessToken(account.accountId), s.anotherAuth().getAccessToken(account.accountId)]), ['mock-access-1', 'mock-access-1']); assert.equal(s.refreshes(), 1);
  assert.equal(await s.auth.signOut(account.accountId), false); assert.ok(s.calls.every(c => !c.url.includes('evil')));
  const stored = await readFile(join(s.directory, `${account.accountId}.json`), 'utf8'); assert.ok(!stored.includes('mock-access')); assert.ok(!stored.includes('mock-refresh')); await assert.rejects(s.auth.getAccessToken(account.accountId), /signed out/);
});
test('service failures never leak response or transport secrets', async t => { const s = await setup(t); const a = await s.begin(); s.set({ leakError: true }); await assert.rejects(s.auth.finishSignIn(a, s.callback()), error => !String(error).includes('SECRET_ACCESS')); });
test('unsafe storage permissions and symlinked credential files rejected', async t => {
  const s = await setup(t); await chmod(s.directory, 0o755); await assert.rejects(s.auth.listAccounts(), /0700/); await chmod(s.directory, 0o700);
  await symlink('/not-a-credential-file', join(s.directory, `${'a'.repeat(64)}.json`)); await assert.rejects(s.auth.listAccounts());
});

test('denial and expired attempts make no token request', async t => {
  const s = await setup(t); let a = await s.begin(); await assert.rejects(s.auth.finishSignIn(a, `${a.redirectURI}?state=${a.state}&error=access_denied`), /declined/); assert.equal(s.calls.length, 0);
  a = await s.begin(); s.set({ advance: 600_001 }); await assert.rejects(s.auth.finishSignIn(a, s.callback()), /expired/); assert.equal(s.calls.length, 0);
});
test('refresh without replacement and changed returning identity preserve the previous saved record', async t => {
  const s = await setup(t); let a = await s.begin(); const account = await s.auth.finishSignIn(a, s.callback()); const file = join(s.directory, `${account.accountId}.json`); const original = await readFile(file, 'utf8');
  s.set({ advance: 3_600_000, omitRefresh: true }); await assert.rejects(s.auth.getAccessToken(account.accountId)); assert.equal(await readFile(file, 'utf8'), original);
  s.set({ omitRefresh: false, subject: 'different-subject' }); a = await s.begin(account.accountId); await assert.rejects(s.auth.finishSignIn(a, s.callback()), /identity changed/); assert.equal(await readFile(file, 'utf8'), original);
});
test('symlink directory ancestors are not followed', async t => {
  const s = await setup(t); const link = `${s.directory}-link`; await symlink(s.directory, link); t.after(() => rm(link));
  await assert.rejects(createChatGPTAuth({ directory: join(link, 'nested') }).listAccounts(), /ancestor/);
});

test('cancelled sign-in and refresh never publish credentials', async t => {
  const s = await setup(t); const a = await s.begin(); const abort = new AbortController(); abort.abort();
  await assert.rejects(s.auth.finishSignIn(a, s.callback(), abort.signal)); assert.equal(s.calls.length, 0); assert.deepEqual(await s.auth.listAccounts(), []);
  const account = await s.auth.finishSignIn(a, s.callback()); s.set({ advance: 3_600_000 }); const before = s.calls.length;
  await assert.rejects(s.auth.getAccessToken(account.accountId, abort.signal)); assert.equal(s.calls.length, before);
});

test('cancellation during a mock token exchange cannot save credentials even when mock transport ignores abort', async t => {
  const s = await setup(t); const a = await s.begin(); const abort = new AbortController(); s.set({ onToken: () => abort.abort() });
  await assert.rejects(s.auth.finishSignIn(a, s.callback(), abort.signal)); assert.deepEqual(await s.auth.listAccounts(), []);
});

test('invalid_grant explicitly restarts fresh authorization with retained issued client ID, without retrying consumed code', async t => {
  const s = await setup(t); const a = await s.begin(); s.set({ invalidGrant: true });
  await assert.rejects(s.auth.finishSignIn(a, s.callback()), ChatGPTSignInRestartRequired); assert.equal(s.calls.length, 1); assert.deepEqual(await s.auth.listAccounts(), []);
  const fresh = await s.auth.restartSignIn(a); const url = new URL(fresh.authorizationURL);
  assert.equal(url.searchParams.get('client_id'), 'oaiapp_mock'); assert.equal(url.searchParams.has('agent_name_hint'), false);
  assert.notEqual(fresh.state, a.state); assert.notEqual(fresh.nonce, a.nonce); assert.notEqual(fresh.verifier, a.verifier); assert.equal(s.calls.length, 1);
  await assert.rejects(s.auth.restartSignIn(a), /cannot be restarted/);
  s.set({ invalidGrant: false, attempt: fresh });
  const account = await s.auth.finishSignIn(fresh, s.callback().replace('&client_id=oaiapp_mock', '')); assert.equal(account.clientId, 'oaiapp_mock');
});
test('restarted authorization rejects callback replacement of retained client ID', async t => {
  const s = await setup(t); const a = await s.begin(); s.set({ invalidGrant: true }); await assert.rejects(s.auth.finishSignIn(a, s.callback()));
  const fresh = await s.auth.restartSignIn(a); s.set({ attempt: fresh, invalidGrant: false }); const before = s.calls.length;
  await assert.rejects(s.auth.finishSignIn(fresh, s.callback().replace('oaiapp_mock', 'another-client')), /client ID/); assert.equal(s.calls.length, before);
});
