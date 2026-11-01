/** User-invoked ChatGPT authorization commands; no sign-in occurs on import. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createChatGPTAuth, ChatGPTSignInRestartRequired } from '@aiw/llm';
import { createInterface } from 'node:readline/promises';

/** Runs the explicit local sign-in/account commands. Browser authorization is never printed. */
export async function authCommand(args: string[]): Promise<void> {
  const [command, accountId, ...extra] = args;
  if (extra.length || !['signin', 'accounts', 'signout', 'models'].includes(command ?? '')) throw new Error('Usage: aiw auth signin [account-id] | accounts | signout <account-id> | models <account-id>');
  const auth = createChatGPTAuth();
  if (command === 'accounts') {
    if (accountId) throw new Error('accounts takes no arguments');
    process.stdout.write(`${JSON.stringify(await auth.listAccounts(), null, 2)}\n`); return;
  }
  if (command === 'signout') {
    if (!accountId) throw new Error('Select an account ID from aiw auth accounts');
    const revoked = await auth.signOut(accountId);
    process.stdout.write(revoked ? 'Signed out.\n' : 'Signed out locally. Remote revocation was not confirmed; disconnect ai-workflow in ChatGPT Settings.\n'); return;
  }
  if (command === 'models') {
    if (!accountId) throw new Error('Select an account ID from aiw auth accounts');
    const token = await auth.getAccessToken(accountId);
    let result: any;
    try {
      const response = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(); result = await response.json();
    } catch { throw new Error('ChatGPT model discovery failed; no inference was attempted'); }
    if (!Array.isArray(result.models)) throw new Error('Unexpected ChatGPT model catalog');
    process.stdout.write(`${JSON.stringify(result.models.filter((m: any) => m.visibility === 'list').map((m: any) => ({ slug: m.slug, display_name: m.display_name })), null, 2)}\n`); return;
  }
  process.stdout.write('Continue with ChatGPT: opening your system browser. This grants ai-workflow renewable access to your shared ChatGPT allowance after you consent. No workflow runs will start.\n');
  const server = createServer();
  const abort = new AbortController();
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Loopback listener unavailable');
    const redirectURI = `http://127.0.0.1:${address.port}/auth/callback`;
    let attempt = await auth.beginSignIn(redirectURI, accountId);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sign-in timed out; run aiw auth signin again')), 600_000);
      let finishing = false;
      server.on('request', async (request, response) => {
        let callback: URL;
        try { callback = new URL(request.url ?? '/', redirectURI); } catch { response.writeHead(400); response.end('Invalid callback'); return; }
        if (request.method !== 'GET' || callback.origin !== new URL(redirectURI).origin || callback.pathname !== '/auth/callback' || callback.searchParams.get('state') !== attempt.state || finishing) { response.writeHead(400); response.end('Invalid callback'); return; }
        finishing = true;
        try {
          const account = await auth.finishSignIn(attempt, callback.href, abort.signal);
          response.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); response.end('Signed in. Return to ai-workflow.');
          process.stdout.write(`Signed in. Account ID: ${account.accountId}\nUse aiw auth models ${account.accountId} to list available models.\n`);
          clearTimeout(timer); resolve();
        } catch (error) {
          response.writeHead(400, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); response.end('Sign-in failed. Return to ai-workflow.');
          if (error instanceof ChatGPTSignInRestartRequired && process.stdin.isTTY && !abort.signal.aborted) {
            const prompt = createInterface({ input: process.stdin, output: process.stdout });
            try {
              const answer = await prompt.question('Authorization code expired. Restart browser authorization with the same registration? [y/N] ', { signal: abort.signal });
              if (answer.trim().toLowerCase() === 'y') {
                abort.signal.throwIfAborted(); attempt = await auth.restartSignIn(attempt); finishing = false; launchBrowser(); return;
              }
            } catch { /* Cancellation or input failure ends this attempt without saving credentials. */ }
            finally { prompt.close(); }
          }
          clearTimeout(timer); reject(new Error('ChatGPT sign-in failed; no credentials were replaced. An issued registration may remain in ChatGPT Settings; reconnect or remove it there before a new first-time sign-in.'));
        }
      });
      /** Opens only a fresh authorization URL; never retries a consumed code. */
      function launchBrowser(): void {
      const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? null : 'xdg-open';
      if (!command) { clearTimeout(timer); reject(new Error('Browser launch is not supported on this platform')); return; }
      // No token hints: only OAuth public parameters enter the browser launcher arguments.
      const browser = spawn(command, [attempt.authorizationURL], { stdio: 'ignore' });
      browser.once('error', () => { clearTimeout(timer); reject(new Error('Could not open the browser; install a system browser launcher')); });
      browser.once('exit', code => { if (code !== 0) { clearTimeout(timer); reject(new Error('Browser launcher failed')); } });
      }
      launchBrowser();
    });
  } finally { abort.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
