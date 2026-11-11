import { describe, expect, it, vi } from 'vitest';
import { LLMError } from '../src/llm/errors';
import { backoffDelay, withRetry } from '../src/llm/retry';

describe('withRetry', () => {
  it('retries retryable errors then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new LLMError('rate_limited', '429', 429))
      .mockRejectedValueOnce(new LLMError('unavailable', '503', 503))
      .mockResolvedValue('ok');
    await expect(withRetry(fn, { baseMs: 1, maxMs: 2 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry auth errors', async () => {
    const fn = vi.fn().mockRejectedValue(new LLMError('auth', 'bad key', 401));
    await expect(withRetry(fn, { baseMs: 1 })).rejects.toMatchObject({ kind: 'auth' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt budget', async () => {
    const fn = vi.fn().mockRejectedValue(new LLMError('rate_limited', '429', 429));
    await expect(withRetry(fn, { attempts: 3, baseMs: 1, maxMs: 2 })).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops waiting when aborted', async () => {
    const ctrl = new AbortController();
    const fn = vi.fn().mockRejectedValue(new LLMError('rate_limited', '429', 429));
    const p = withRetry(fn, { baseMs: 10_000, maxMs: 10_000, signal: ctrl.signal, attempts: 5 });
    setTimeout(() => ctrl.abort(), 10);
    await expect(p).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('backoffDelay', () => {
  it('stays within the exponential ceiling', () => {
    for (let i = 0; i < 50; i++) {
      expect(backoffDelay(3, { baseMs: 100, maxMs: 10_000 })).toBeLessThanOrEqual(800);
    }
  });

  it('prefers the server retry hint, capped', () => {
    expect(backoffDelay(0, { baseMs: 100, maxMs: 5000 }, 2000)).toBe(2000);
    expect(backoffDelay(0, { baseMs: 100, maxMs: 5000 }, 60_000)).toBe(5000);
  });
});

describe('retry limits', () => {
  it('does not wait out a server delay longer than the cap', async () => {
    const fn = vi.fn().mockRejectedValue(new LLMError('rate_limited', '429', 429, 60_000));
    await expect(withRetry(fn, { baseMs: 1, maxMs: 15_000 })).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 504 on the same model', async () => {
    const fn = vi.fn().mockRejectedValue(new LLMError('unavailable', 'deadline', 504));
    await expect(withRetry(fn, { baseMs: 1 })).rejects.toMatchObject({ status: 504 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('never retries an exhausted daily quota', async () => {
    const fn = vi.fn().mockRejectedValue(new LLMError('quota_exhausted', 'per day', 429));
    await expect(withRetry(fn, { baseMs: 1 })).rejects.toMatchObject({ kind: 'quota_exhausted' });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
