/**
 * Error class of a failed request (runner §4.4): `infra` is retried and not counted
 * (429/5xx/network/timeout, empty or content-filtered response); `context-limit` ends the job as a
 * framework fail; `other` is any remaining API error.
 */
export type LLMErrorKind = "infra" | "context-limit" | "other";

/** A failed model request, classified for the runner. */
export class LLMError extends Error {
  constructor(
    readonly kind: LLMErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

const CONTEXT_LIMIT = /context[ _-]?(length|window)|maximum context|too many tokens|prompt is too long/i;

/**
 * Classifies an API error by HTTP status (or the provider's error `code`) and message.
 * @param status - HTTP status, or the `error.code` of an error returned with HTTP 200
 * @param message - provider error message
 */
export function classifyAPIError(status: number | undefined, message: string): LLMErrorKind {
  if (CONTEXT_LIMIT.test(message)) return "context-limit";
  if (status === undefined || status === 408 || status === 429 || status >= 500) return "infra";
  return "other";
}
