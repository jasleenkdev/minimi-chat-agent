export type LLMErrorKind = 'rate_limited' | 'auth' | 'unavailable' | 'bad_request' | 'aborted' | 'unknown';

const userMessages: Record<LLMErrorKind, string> = {
  rate_limited: 'The model is rate limited right now. Wait a few seconds and try again.',
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

  get retryable(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'unavailable';
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
