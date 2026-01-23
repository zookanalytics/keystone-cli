import { describe, expect, test } from 'bun:test';
import { validateRemoteUrl } from '../mcp-client';
import { executeShell } from './shell-executor';

describe('Verification Fixes', () => {
  describe('SSRF Protection (mcp-client)', () => {
    test('validateRemoteUrl should throw on 127.0.0.1', async () => {
      expect(validateRemoteUrl('https://127.0.0.1')).rejects.toThrow('SSRF Protection');
    });

    test('validateRemoteUrl should throw on localhost', async () => {
      expect(validateRemoteUrl('https://localhost')).rejects.toThrow('SSRF Protection');
    });

    test('validateRemoteUrl should throw on metadata IP', async () => {
      expect(validateRemoteUrl('https://169.254.169.254')).rejects.toThrow('SSRF Protection');
    });
  });

  describe('Shell Path Traversal (shell-executor)', () => {
    const mockContext = { env: {}, steps: {}, inputs: {}, envOverrides: {}, secrets: {} };

    test('should allow command with ".." and "/"', async () => {
      const step = {
        id: 'test',
        type: 'shell' as const,
        run: 'cat ../secret.txt',
      };
      // Commands with .. are allowed (only dir step property is validated)
      const result = await executeShell(step, mockContext);
      // Will fail because file doesn't exist, but not blocked
      expect(result.exitCode).toBe(1);
    });

    test('should allow absolute path with ".."', async () => {
      const step = {
        id: 'test',
        type: 'shell' as const,
        run: '/bin/ls ../',
      };
      // Absolute paths are allowed in run command
      const result = await executeShell(step, mockContext);
      expect(result.exitCode).toBe(0); // ls should succeed
    });
  });
});
