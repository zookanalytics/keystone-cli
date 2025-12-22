import { describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import type { ExpressionContext } from '../expression/evaluator.ts';
import type { Step } from '../parser/schema.ts';
import { DebugRepl } from './debug-repl.ts';

describe('DebugRepl', () => {
  const mockContext: ExpressionContext = { inputs: { foo: 'bar' } };
  // biome-ignore lint/suspicious/noExplicitAny: mock step typing
  const mockStep: Step = { id: 'test-step', type: 'shell', run: 'echo "fail"' } as any;
  const mockError = new Error('Test Error');

  test('should resolve with "skip" when user types "skip"', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const repl = new DebugRepl(mockContext, mockStep, mockError, input, output);

    const promise = repl.start();

    // Wait a tick for prompt
    await new Promise((r) => setTimeout(r, 10));

    input.write('skip\n');

    const result = await promise;
    expect(result).toEqual({ type: 'skip' });
  });

  test('should resolve with "retry" when user types "retry"', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const repl = new DebugRepl(mockContext, mockStep, mockError, input, output);

    const promise = repl.start();

    await new Promise((r) => setTimeout(r, 10));
    input.write('retry\n');

    const result = await promise;
    expect(result.type).toBe('retry');
    expect(result.modifiedStep).toBe(mockStep);
  });

  test('should resolve with "continue_failure" when user types "exit"', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const repl = new DebugRepl(mockContext, mockStep, mockError, input, output);

    const promise = repl.start();

    await new Promise((r) => setTimeout(r, 10));
    input.write('exit\n');

    const result = await promise;
    expect(result).toEqual({ type: 'continue_failure' });
  });
});
