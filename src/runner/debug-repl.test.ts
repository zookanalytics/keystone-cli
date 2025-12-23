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
    const mockLogger = { log: () => {}, error: () => {}, warn: () => {} };
    const repl = new DebugRepl(mockContext, mockStep, mockError, mockLogger, input, output);

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
    const mockLogger = { log: () => {}, error: () => {}, warn: () => {} };
    const repl = new DebugRepl(mockContext, mockStep, mockError, mockLogger, input, output);

    const promise = repl.start();

    await new Promise((r) => setTimeout(r, 10));
    input.write('retry\n');

    const result = await promise;
    expect(result.type).toBe('retry');
    if (result.type === 'retry') {
      expect(result.modifiedStep).toBe(mockStep);
    }
  });

  test('should resolve with "continue_failure" when user types "exit"', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const mockLogger = { log: () => {}, error: () => {}, warn: () => {} };
    const repl = new DebugRepl(mockContext, mockStep, mockError, mockLogger, input, output);

    const promise = repl.start();

    await new Promise((r) => setTimeout(r, 10));
    input.write('exit\n');

    const result = await promise;
    expect(result).toEqual({ type: 'continue_failure' });
  });

  test('should parse shell commands correctly', () => {
    // We import the function dynamically to test it, or we assume it's exported
    const { parseShellCommand } = require('./debug-repl.ts');

    expect(parseShellCommand('code')).toEqual(['code']);
    expect(parseShellCommand('code --wait')).toEqual(['code', '--wait']);
    expect(parseShellCommand('code --wait "some file"')).toEqual(['code', '--wait', 'some file']);
    expect(parseShellCommand("vim 'my file'")).toEqual(['vim', 'my file']);
    expect(parseShellCommand('editor -a -b -c')).toEqual(['editor', '-a', '-b', '-c']);
    expect(parseShellCommand('  spaced   command  ')).toEqual(['spaced', 'command']);
  });
});
