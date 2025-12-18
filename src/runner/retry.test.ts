import { describe, expect, spyOn, test } from 'bun:test';
import { withRetry } from './retry';

describe('withRetry', () => {
  test('should return result if fn succeeds on first try', async () => {
    const fn = async () => 'success';
    const result = await withRetry(fn, { count: 3, backoff: 'linear' });
    expect(result).toBe('success');
  });

  test('should retry and succeed', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 3) throw new Error('fail');
      return 'success';
    };

    // Use a small delay for tests if possible, but retry.ts has hardcoded 1000ms base delay.
    // This test might take a few seconds.
    const result = await withRetry(fn, { count: 3, backoff: 'linear' });
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  }, 10000); // 10s timeout

  test('should throw after exhausting retries', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new Error('fail');
    };

    await expect(withRetry(fn, { count: 2, backoff: 'linear' })).rejects.toThrow('fail');
    expect(attempts).toBe(3); // 1 original + 2 retries
  }, 10000);

  test('should call onRetry callback', async () => {
    let attempts = 0;
    const onRetry = (attempt: number, error: Error) => {
      expect(attempt).toBeGreaterThan(0);
      expect(error.message).toBe('fail');
    };

    const fn = async () => {
      attempts++;
      if (attempts < 2) throw new Error('fail');
      return 'success';
    };

    await withRetry(fn, { count: 1, backoff: 'linear' }, onRetry);
  }, 5000);
});
