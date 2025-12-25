import { afterEach, describe, expect, it } from 'bun:test';
import { SafeSandbox } from './sandbox';

describe('SafeSandbox', () => {
  afterEach(() => {
    SafeSandbox.resetWarning();
  });

  it('should execute basic arithmetic', async () => {
    const result = await SafeSandbox.execute('return 1 + 2', {});
    expect(result).toBe(3);
  });

  it('should have access to context variables', async () => {
    const result = await SafeSandbox.execute('return a + b', { a: 10, b: 20 });
    expect(result).toBe(30);
  });

  it('should not have access to Node.js globals', async () => {
    const result = await SafeSandbox.execute('return typeof process', {});
    expect(result).toBe('undefined');
  });

  it('should handle object results', async () => {
    const result = await SafeSandbox.execute('return { x: 1, y: 2 }', {});
    expect(result).toEqual({ x: 1, y: 2 });
  });

  it('should respect timeouts', async () => {
    const promise = SafeSandbox.execute('while(true) {}', {}, { timeout: 100 });
    await expect(promise).rejects.toThrow();
  });
});
