/** Public Sign in with ChatGPT flow. Never reads another application's credentials. */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, rename, unlink, readdir, rmdir } from 'node:fs/promises';
import { join, resolve, parse } from 'node:path';
import { homedir } from 'node:os';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';

const ISSUER = 'https://auth.openai.com';
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const JWKS = `${ISSUER}/.well-known/jwks.json`;
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
interface RecordData {
  accountId: string; subject: string; clientId: string; hostId: string; email?: string;
  accessToken?: string; refreshToken?: string; idToken?: string; expiresAt?: number; scopes: string[];
}
export type ChatGPTAccount = Pick<RecordData, 'accountId' | 'clientId' | 'email'> & { signedIn: boolean };
export interface SignInAttempt {
  /** Secret-bearing URL: pass directly to a browser, never print or log. */
  authorizationURL: string;
  redirectURI: string; state: string; nonce: string; verifier: string; hostId: string;
  selected?: RecordData; createdAt: number; used: boolean;
  issuedClientId?: string; restartAllowed?: boolean;
}
/** A consumed authorization code needs fresh browser authorization, never a token retry. */
export class ChatGPTSignInRestartRequired extends Error {
  constructor() { super('ChatGPT authorization code expired; explicitly restart browser authorization with the same registration'); this.name = 'ChatGPTSignInRestartRequired'; }
}
export interface ChatGPTAuthOptions { directory?: string; fetch?: typeof fetch; now?: () => number }
/** Non-sensitive errors deliberately exclude provider response bodies and exception causes. */
function fail(message: string): never { throw new Error(`ChatGPT sign-in: ${message}`); }
function required(value: unknown): string { if (typeof value !== 'string' || !value) fail('invalid credential response'); return value; }
function accountId(subject: string, clientId: string): string { return createHash('sha256').update(JSON.stringify([ISSUER, subject, clientId])).digest('hex'); }
function safeEqual(a: string, b: string): boolean { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function assertScopes(scopes: string[]): void { if (!['openid', 'resource.invoke', 'chatgpt.tokens.use.direct'].every(s => scopes.includes(s))) fail('ChatGPT plan permission was not granted; sign in again and review consent'); }
function parseScopes(value: unknown): string[] { return required(value).split(/\s+/).filter(Boolean); }
/** App-owned protected storage; symlinks and unsafe existing permissions fail closed. */
export function createChatGPTAuth(options: ChatGPTAuthOptions = {}) {
  const directory = options.directory ?? join(homedir(), '.config', 'ai-workflow', 'chatgpt');
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  async function ensure(): Promise<void> {
    const absolute = resolve(directory);
    let current = parse(absolute).root;
    for (const part of absolute.slice(current.length).split('/').filter(Boolean)) {
      current = join(current, part);
      try { await mkdir(current, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const st = await lstat(current);
      const uid = process.getuid?.();
      const trustedOwner = uid === undefined || st.uid === uid || st.uid === 0;
      // A root-owned sticky temporary parent is acceptable; credential directory itself never is.
      const stickyParent = current !== absolute && st.uid === 0 && Boolean(st.mode & 0o1000);
      if (!st.isDirectory() || st.isSymbolicLink() || !trustedOwner || ((st.mode & 0o022) && !stickyParent)) fail('unsafe credential directory ancestor');
      if (current === absolute && ((st.mode & 0o077) || (uid !== undefined && st.uid !== uid))) fail('credential directory must be owned by you with mode 0700');
    }
  }
  function path(id: string): string { if (!/^[a-f0-9]{64}$/.test(id)) fail('invalid account selection'); return join(directory, `${id}.json`); }
  async function readFile(file: string): Promise<any> {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const st = await handle.stat();
      if (!st.isFile() || (st.mode & 0o077) || (process.getuid && st.uid !== process.getuid())) fail('credential file must be owned by you with mode 0600');
      try { return JSON.parse(await handle.readFile('utf8')); } catch { fail('invalid credential file'); }
    } finally { await handle.close(); }
  }
  async function writeFile(file: string, value: unknown, signal?: AbortSignal): Promise<void> {
    await ensure();
    const tmp = join(directory, `.write-${randomUUID()}`);
    const handle = await open(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try {
      try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
      signal?.throwIfAborted(); await rename(tmp, file);
    } finally { await unlink(tmp).catch(() => {}); }
  }
  async function locked<T>(name: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await ensure();
    const lock = join(directory, `.lock-${name}`);
    const deadline = Date.now() + 30_000;
    while (true) {
      signal?.throwIfAborted();
      try { await mkdir(lock, { mode: 0o700 }); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      if (Date.now() >= deadline) fail('credential store busy; retry after the other process exits (stale locks require manual inspection)');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    try { return await work(); } finally { await rmdir(lock); }
  }
  async function read(id: string): Promise<RecordData> {
    await ensure();
    const value = await readFile(path(id)) as RecordData;
    if (value.accountId !== id || accountId(required(value.subject), required(value.clientId)) !== id || !Array.isArray(value.scopes)) fail('invalid account record');
    return value;
  }
  async function request(url: string, init: RequestInit = {}, allowErrorResponse = false): Promise<Response> {
    // All callers use constants or origin-validated discovery metadata. Never follow a redirect.
    try {
      const response = await fetcher(url, { ...init, redirect: 'error', signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
      if (!response.ok && !allowErrorResponse) fail(`authorization service returned HTTP ${response.status}; retry sign-in if necessary`);
      return response;
    } catch { fail('authorization service request failed; credentials were not replaced'); }
  }
  async function json(url: string, init?: RequestInit): Promise<any> { try { return await (await request(url, init)).json(); } catch { fail('authorization service response invalid or unavailable'); } }
  async function exchange(params: Record<string, string>, signal?: AbortSignal): Promise<any> {
    const response = await request(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, resource: RESOURCE }), signal }, true);
    let value: any;
    try { value = await response.json(); } catch { fail('authorization service response invalid'); }
    if (!response.ok || value.error) {
      if (params.grant_type === 'authorization_code' && value.error === 'invalid_grant') throw new ChatGPTSignInRestartRequired();
      fail('authorization service rejected credentials; sign in again if necessary');
    }
    return value;
  }
  async function identity(token: string, clientId: string, nonce?: string, signal?: AbortSignal): Promise<{subject: string; email?: string}> {
    const keys = await json(JWKS, { signal }) as JSONWebKeySet;
    try {
      const { payload } = await jwtVerify(token, createLocalJWKSet(keys), { issuer: ISSUER, audience: clientId, algorithms: ['RS256'], currentDate: new Date(now()), requiredClaims: ['exp', 'iat', 'sub'] });
      if (nonce !== undefined && (typeof payload.nonce !== 'string' || !safeEqual(payload.nonce, nonce))) fail('ID token nonce mismatch');
      if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) fail('ID token authorized party mismatch');
      if (payload.azp !== undefined && payload.azp !== clientId) fail('ID token authorized party mismatch');
      return { subject: required(payload.sub), ...(typeof payload.email === 'string' ? { email: payload.email } : {}) };
    } catch { fail('ID token validation failed'); }
  }
  function tokens(value: any, previous?: RecordData): Pick<RecordData, 'accessToken' | 'refreshToken' | 'idToken' | 'expiresAt' | 'scopes'> {
    if (value.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(value.expires_in) || value.expires_in <= 0) fail('invalid token response');
    const scopes = value.scope === undefined && previous ? previous.scopes : parseScopes(value.scope);
    assertScopes(scopes);
    return { accessToken: required(value.access_token), refreshToken: required(value.refresh_token), idToken: required(value.id_token ?? previous?.idToken), expiresAt: now() + value.expires_in * 1000, scopes };
  }
  return {
    /** Begins only when explicitly requested by the user. Listener must already be running. */
    async beginSignIn(redirectURI: string, selectedAccountId?: string): Promise<SignInAttempt> {
      const redirect = new URL(redirectURI);
      if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || !redirect.port || redirect.pathname !== '/auth/callback' || redirect.search || redirect.hash || redirect.username || redirect.password) fail('invalid loopback callback');
      const hostId = await locked('host', async () => {
        const file = join(directory, 'host.json');
        try { const host = await readFile(file); if (typeof host.id !== 'string' || !/^urn:uuid:[a-f0-9-]{36}$/.test(host.id)) fail('invalid host record'); return host.id; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        const id = `urn:uuid:${randomUUID()}`; await writeFile(file, { id }); return id;
      });
      const selected = selectedAccountId ? await read(selectedAccountId) : undefined;
      const state = randomBytes(32).toString('base64url'); const nonce = randomBytes(32).toString('base64url'); const verifier = randomBytes(32).toString('base64url');
      const params = new URLSearchParams({ client_id: selected?.clientId ?? 'dynamic_agent_client', ext_agent_host_id: hostId, response_type: 'code', redirect_uri: redirectURI, scope: SCOPES, resource: RESOURCE, state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
      if (!selected) params.set('agent_name_hint', 'ai-workflow');
      // Omit optional hints: avoids placing retained ID tokens in browser process arguments/history.
      return { authorizationURL: `${AUTHORIZE}?${params}`, redirectURI, state, nonce, verifier, hostId, selected, createdAt: now(), used: false };
    },
    /** Starts a fresh, explicitly requested authorization after invalid_grant; no credentials are persisted. */
    async restartSignIn(attempt: SignInAttempt): Promise<SignInAttempt> {
      if (!attempt.restartAllowed || !attempt.used || !attempt.issuedClientId) fail('sign-in cannot be restarted from this attempt');
      attempt.restartAllowed = false;
      const fresh = await this.beginSignIn(attempt.redirectURI, attempt.selected?.accountId);
      fresh.issuedClientId = attempt.issuedClientId;
      const url = new URL(fresh.authorizationURL);
      url.searchParams.set('client_id', attempt.issuedClientId);
      url.searchParams.delete('agent_name_hint');
      fresh.authorizationURL = url.href;
      return fresh;
    },
    /** Validates and consumes a one-shot callback before replacing any saved credentials. */
    async finishSignIn(attempt: SignInAttempt, callbackURL: string, signal?: AbortSignal): Promise<ChatGPTAccount> {
      signal?.throwIfAborted();
      if (attempt.used || now() - attempt.createdAt > 600_000) fail('sign-in attempt expired or already used');
      const url = new URL(callbackURL);
      if (`${url.origin}${url.pathname}` !== attempt.redirectURI || url.hash || url.username || url.password) fail('callback URI mismatch');
      for (const key of ['state', 'code', 'client_id', 'error']) if (url.searchParams.getAll(key).length > 1) fail('duplicate callback parameter');
      if (!safeEqual(url.searchParams.get('state') ?? '', attempt.state)) fail('callback state mismatch');
      attempt.used = true;
      if (url.searchParams.has('error')) fail('authorization declined or failed');
      const clientId = url.searchParams.get('client_id') ?? attempt.issuedClientId ?? attempt.selected?.clientId;
      if (!clientId || clientId === 'dynamic_agent_client' || (attempt.selected && clientId !== attempt.selected.clientId) || (attempt.issuedClientId && clientId !== attempt.issuedClientId)) fail('invalid issued client ID');
      attempt.issuedClientId = clientId;
      let value: any;
      try { value = await exchange({ grant_type: 'authorization_code', client_id: clientId, code: required(url.searchParams.get('code')), code_verifier: attempt.verifier, redirect_uri: attempt.redirectURI }, signal); }
      catch (error) { if (error instanceof ChatGPTSignInRestartRequired) attempt.restartAllowed = true; throw error; }
      const verified = await identity(required(value.id_token), clientId, attempt.nonce, signal);
      if (attempt.selected && verified.subject !== attempt.selected.subject) fail('selected account identity changed');
      const record: RecordData = { accountId: accountId(verified.subject, clientId), subject: verified.subject, clientId, hostId: attempt.hostId, email: verified.email, ...tokens(value) };
      signal?.throwIfAborted();
      if (now() - attempt.createdAt > 600_000) fail('sign-in attempt expired');
      await locked(record.accountId, () => writeFile(path(record.accountId), record, signal), signal);
      return { accountId: record.accountId, clientId, email: record.email, signedIn: true };
    },
    /** Lists only safe account metadata, never token material. */
    async listAccounts(): Promise<ChatGPTAccount[]> {
      await ensure(); const result: ChatGPTAccount[] = [];
      for (const file of await readdir(directory)) if (/^[a-f0-9]{64}\.json$/.test(file)) { const r = await read(file.slice(0, -5)); result.push({ accountId: r.accountId, clientId: r.clientId, email: r.email, signedIn: Boolean(r.accessToken && r.refreshToken) }); }
      return result;
    },
    /** Refreshes under a cross-process lock; caller must keep the returned secret out of telemetry. */
    async getAccessToken(id: string, signal?: AbortSignal): Promise<string> {
      path(id);
      return locked(id, async () => {
        const record = await read(id); assertScopes(record.scopes);
        if (!record.accessToken || !record.refreshToken) fail('account signed out');
        if ((record.expiresAt ?? 0) > now() + 60_000) return record.accessToken;
        const response = await exchange({ grant_type: 'refresh_token', client_id: record.clientId, refresh_token: record.refreshToken }, signal);
        const updated = { ...record, ...tokens(response, record) };
        if (response.id_token) { const verified = await identity(response.id_token, record.clientId, undefined, signal); if (verified.subject !== record.subject) fail('refreshed identity changed'); }
        signal?.throwIfAborted(); await writeFile(path(id), updated, signal); return required(updated.accessToken);
      }, signal);
    },
    /** Attempts remote revocation and clears local tokens; false means remote revocation unconfirmed. */
    async signOut(id: string): Promise<boolean> {
      path(id);
      return locked(id, async () => {
        const record = await read(id); let revoked = !record.refreshToken;
        if (record.refreshToken) {
          try {
            const metadata = await json(DISCOVERY); const endpoint = new URL(required(metadata.revocation_endpoint));
            if (metadata.issuer !== ISSUER || endpoint.origin !== ISSUER || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) fail('untrusted revocation endpoint');
            await request(endpoint.href, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: record.refreshToken, token_type_hint: 'refresh_token', client_id: record.clientId }) }); revoked = true;
          } catch { revoked = false; }
        }
        const { accessToken: _a, refreshToken: _r, idToken: _i, expiresAt: _e, ...retained } = record;
        await writeFile(path(id), retained); return revoked;
      });
    },
  };
}
