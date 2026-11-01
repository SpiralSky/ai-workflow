/**
 * Attach one best-effort asynchronous cancellation action, including already-aborted signals.
 * The returned cleanup detaches the listener and waits for the action to settle; callers must
 * handle cancellation failures inside the action so evidence is retained rather than discarded.
 */
export function onCancellation(signal: AbortSignal | undefined, cancel: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | undefined;
  const abort = () => { pending ??= Promise.resolve().then(cancel); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  return async () => {
    signal?.removeEventListener("abort", abort);
    await pending;
  };
}
