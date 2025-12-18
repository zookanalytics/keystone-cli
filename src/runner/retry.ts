import type { RetryConfig } from '../parser/schema.ts';

/**
 * Calculate backoff delay in milliseconds
 */
function calculateBackoff(
  attempt: number,
  backoff: 'linear' | 'exponential',
  baseDelay = 1000
): number {
  if (backoff === 'exponential') {
    return baseDelay * 2 ** attempt;
  }
  // Linear backoff
  return baseDelay * (attempt + 1);
}

/**
 * Sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retry?: RetryConfig,
  onRetry?: (attempt: number, error: Error) => void
): Promise<T> {
  const maxRetries = retry?.count || 0;
  const backoffType = retry?.backoff || 'linear';
  const baseDelay = retry?.baseDelay ?? 1000;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if we've exhausted attempts
      if (attempt >= maxRetries) {
        break;
      }

      // Calculate delay and wait before retry
      const delay = calculateBackoff(attempt, backoffType, baseDelay);
      onRetry?.(attempt + 1, lastError);
      await sleep(delay);
    }
  }

  throw lastError || new Error('Operation failed with no error details');
}
