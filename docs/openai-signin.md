# Run workflows using Sign in with ChatGPT

This experimental backend uses the **official ChatGPT plan-usage flow** and public Responses API. It preserves ai-workflow's main agent, selection/reranking and secondary executors. OpenRouter remains the default.

The account must be eligible for OpenAI's open-source/local-client flow. Access uses the account's **shared allowance**, not a separate free pool or API-credit grant. Check [ChatGPT Settings](https://chatgpt.com/#settings) for app access and usage. Models and quota availability depend on the selected account. There is no automatic paid-provider fallback.

## Deliberate sign-in on your local computer

After installing repository dependencies, run the CLI via `node --import tsx packages/runner/src/cli.ts` (abbreviated `aiw` below). These commands are instructions for the user, not actions already performed by the developer.

```sh
aiw auth signin
aiw auth accounts
aiw auth models <account-id>
```

`signin` starts an HTTP loopback callback on `127.0.0.1`, then opens your system browser with **Continue with ChatGPT**. Review and consent to the requested renewable account/plan access there. You do not paste a password, bearer token, Codex credential file or private session token into ai-workflow. No model run starts during sign-in.

Choose the stable account ID printed by the CLI and a model **slug** returned by `auth models`. Multiple account/workspace registrations remain distinct even if they share an email. Reauthorize an existing registration with `aiw auth signin <account-id>`; running an evaluation never opens login automatically. If an authorization code expires, the interactive CLI can ask you to restart browser authorization with the same issued registration and fresh PKCE/state/nonce. It never silently retries a consumed code.

Credentials belong only to this app under `~/.config/ai-workflow/chatgpt/` with directory mode0700/file mode0600. Do not copy them into a repository, container image, Actions secret, log or support message. Refresh is serialized across processes. An abandoned lock fails closed and requires inspection before removal. Linux/macOS browser launch is supported; Windows is explicitly not implemented. Live sign-in has not been validated in this development sandbox, which cannot bind sockets.

## Explicitly bounded subscription run

```sh
aiw eval --problems smoke --mode compare --tools S \
  --provider chatgpt --usage-mode subscription \
  --account <account-id> --model <available-model-slug> \
  --max-calls 30 --max-tokens 100000 --max-duration-ms 600000
```

This example is **not authorization to execute a live run**. Choose bounds appropriate to your allowance. The same provider/account applies to both main and secondary agents; `--secondary-model` can select another available slug. Subscription campaigns require concurrency1. The model catalog is checked for both roles before creating the run. OpenRouter keys/base-URL environment settings cannot redirect this provider.

- Every main, selection/rerank and executor request shares the same serialized call counter.
- `--max-calls` is a pre-dispatch cap; `--max-tokens` stops new requests after observed input+output usage reaches the threshold. A final response may exceed that threshold because this preview **does not support max_output_tokens**.
- `--max-duration-ms` aborts provider traffic at the deadline. Cancellation is best effort and does not undo consumed allowance.
- First terminal task/provider failure stops the campaign. No retries, silent continuation after failed inference, or fallback to paid OpenRouter occurs.
- Dollar cost remains **unknown/null**, not `$0`. Token/cache counters and completed/requested calls are recorded separately. Missing cache fields remain missing, with per-field reporting counts. These counters do not reveal a dollar price or the remaining plan allowance.
- Do not pass `--budget` or `--temperature` in subscription mode. The backend sends `stream:true`, `store:false`, full history and client tool namespaces, omitting unsupported fields. Recorded inference settings distinguish these from the OpenRouter defaults.

The benchmark task set, grading and success criteria are unchanged. Reaching a quota/time/token limit leaves the full target incomplete; it is not a passing campaign. Diagnose failures before starting another run.

## Sign out

Stop your active campaigns first, then:

```sh
aiw auth signout <account-id>
```

This attempts remote refresh-session revocation and clears local tokens while retaining the registration identity. If remote revocation cannot be confirmed, the CLI tells you to disconnect the app in ChatGPT Settings. It cannot guarantee immediate interruption of another process's in-flight request.

For an eligible self-hosted VM, follow [OpenAI's VM instructions](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms) only after deciding how you will authorize and protect that environment. This implementation does not provision OAuth credentials in GitHub Actions or Codespaces.
