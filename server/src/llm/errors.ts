export type LLMErrorKind = 'rate_limited' | 'quota_exhausted' | 'auth' | 'unavailable' | 'bad_request' | 'aborted' | 'unknown';

const userMessages: Record<LLMErrorKind, string> = {
  rate_limited: 'The model is rate limited right now. Wait a few seconds and try again.',
  quota_exhausted: 'The daily free-tier quota for the model is used up. Try again later or set MODEL_MAIN to another model.',
  auth: 'The model API key was rejected. Check the key in .env.',
  unavailable: 'The model is overloaded or unavailable right now. Try again in a moment.',
  bad_request: 'The model rejected the request.',
  aborted: 'Request cancelled.',
  unknown: 'Something went wrong talking to the model.',
};

export class LLMError extends Error {
  constructor(
    readonly kind: LLMErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'LLMError';
  }

  get userMessage(): string {
    return userMessages[this.kind];
  }

  /** Worth retrying on the same model. A 504 already burned the server's whole deadline, so it is not. */
  get retryable(): boolean {
    return this.kind === 'rate_limited' || (this.kind === 'unavailable' && this.status !== 504);
  }

  /** Worth trying a different model. */
  get canFallback(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'quota_exhausted' || this.kind === 'unavailable';
  }
}

export function kindFromStatus(status: number | undefined, message = ''): LLMErrorKind {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth';
  if (status === 400 && /api key/i.test(message)) return 'auth';
  if (status === 400 || status === 404) return 'bad_request';
  if (status !== undefined && status >= 500) return 'unavailable';
  return 'unknown';
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message));
}
