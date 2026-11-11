import { LLMError } from './errors';

export interface RetryOptions {
  attempts: number;
  baseMs: number;
  maxMs: number;
  signal?: AbortSignal;
  onRetry?: (err: LLMError, attempt: number, delayMs: number) => void;
}

const defaults: RetryOptions = { attempts: 4, baseMs: 800, maxMs: 15_000 };

/** Exponential backoff with full jitter; a server-provided retry delay wins when present. */
export function backoffDelay(attempt: number, opts: Pick<RetryOptions, 'baseMs' | 'maxMs'>, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, opts.maxMs);
  const ceiling = Math.min(opts.maxMs, opts.baseMs * 2 ** attempt);
  return Math.round(Math.random() * ceiling);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new LLMError('aborted', 'aborted'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LLMError('aborted', 'aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withRetry<T>(fn: () => Promise<T>, options: Partial<RetryOptions> = {}): Promise<T> {
  const opts = { ...defaults, ...options };
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof LLMError) || !err.retryable || attempt >= opts.attempts - 1) throw err;
      const delay = backoffDelay(attempt, opts, err.retryAfterMs);
      opts.onRetry?.(err, attempt + 1, delay);
      await sleep(delay, opts.signal);
    }
  }
}
