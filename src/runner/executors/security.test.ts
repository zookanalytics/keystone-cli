import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { AUTO_LOAD_SECRET_PREFIXES } from '../../utils/env-constants';
import { SecretManager } from '../services/secret-manager';
import { detectShellInjectionRisk } from './shell-executor';

describe('Security Fixes', () => {
  describe('ShellExecutor Command Injection', () => {
    test('detectShellInjectionRisk should block newlines', () => {
      // Regular space should be allowed
      expect(detectShellInjectionRisk('echo hello')).toBe(false);

      // Newline characters should be detected as risk
      expect(detectShellInjectionRisk('echo hello\n')).toBe(true);
      expect(detectShellInjectionRisk('echo hello\r')).toBe(true);
      expect(detectShellInjectionRisk('echo hello\nrm -rf /')).toBe(true);

      // Standard allowed characters should still pass
      expect(detectShellInjectionRisk('curl -X POST https://example.com/api')).toBe(false);
      expect(detectShellInjectionRisk('file_name-v1.0+beta.txt')).toBe(false);
    });

    test('detectShellInjectionRisk should correctly handle quotes', () => {
      // Content inside single quotes is considered safe (literal)
      expect(detectShellInjectionRisk("echo 'safe string with ; and |'")).toBe(false);

      // But unsafe chars outside quotes must be caught
      expect(detectShellInjectionRisk("echo 'safe'; rm -rf /")).toBe(true);
    });
  });

  describe('SecretManager Auto-loading', () => {
    // Save original env to restore later
    const originalEnv = { ...Bun.env };

    afterAll(() => {
      // Restore env
      for (const key of Object.keys(Bun.env)) {
        delete Bun.env[key];
      }
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value) Bun.env[key] = value;
      }
    });

    test('should only load secrets with allowed prefixes', () => {
      // Setup test env vars
      Bun.env.KEYSTONE_TEST_SECRET = 'secret-value-1';
      Bun.env.GITHUB_TOKEN = 'gh-token-123';
      Bun.env.MY_RANDOM_TOKEN = 'unsafe-token-should-not-load';
      Bun.env.SOME_API_KEY = 'unsafe-api-key';

      const secretManager = new SecretManager();
      const secrets = secretManager.loadSecrets();

      expect(secrets.KEYSTONE_TEST_SECRET).toBe('secret-value-1');
      expect(secrets.GITHUB_TOKEN).toBe('gh-token-123');

      // Should NOT load these even though they contain "TOKEN" or "KEY"
      expect(secrets.MY_RANDOM_TOKEN).toBeUndefined();
      expect(secrets.SOME_API_KEY).toBeUndefined();
    });

    test('env constants should match implementation', () => {
      // Quick sanity check that our test logic matches the constants
      expect(AUTO_LOAD_SECRET_PREFIXES).toContain('KEYSTONE_');
      expect(AUTO_LOAD_SECRET_PREFIXES).toContain('GITHUB_');
    });
  });
});
