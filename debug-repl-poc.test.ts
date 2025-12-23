import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Step } from './src/parser/schema.ts';
import { DebugRepl } from './src/runner/debug-repl.ts';

describe('DebugRepl Security', () => {
  // biome-ignore lint/suspicious/noExplicitAny: Jest spy type
  let writeFileSpy: any;
  // biome-ignore lint/suspicious/noExplicitAny: Jest spy type
  let spawnSyncSpy: any;

  beforeEach(() => {
    // Mock fs.writeFileSync to capture the file path
    writeFileSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    // Mock fs.readFileSync to return valid step JSON
    jest
      .spyOn(fs, 'readFileSync')
      .mockReturnValue(JSON.stringify({ id: 'test', type: 'shell', run: 'echo' }));

    // Mock spawnSync to avoid actual editor launch
    spawnSyncSpy = jest
      .spyOn(require('node:child_process'), 'spawnSync')
      .mockReturnValue({ error: null });
    process.env.EDITOR = 'echo';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should sanitize step ID to prevent path traversal', () => {
    const maliciousStep: Step = {
      id: '../malicious_file',
      type: 'shell',
      run: 'echo "hacked"',
    };

    const repl = new DebugRepl({}, maliciousStep, new Error('foo'));

    // Tricky: editStep is private. We can access it via casting to any,
    // OR trigger it via the public start() method by mocking readline.
    // Let's use 'any' casting for direct unit testing of the logic.

    // biome-ignore lint/suspicious/noExplicitAny: Accessing private method for testing
    (repl as any).editStep(maliciousStep);

    expect(writeFileSpy).toHaveBeenCalled();
    const callArgs = writeFileSpy.mock.calls[0];
    const filePath = callArgs[0] as string;

    // Verify sanitization
    expect(filePath).not.toContain('..');
    expect(filePath).toContain('___malicious_file'); // Sanitized version of ../malicious_file

    // Verify it is in tmpdir
    expect(filePath.startsWith(os.tmpdir())).toBe(true);
  });
});
