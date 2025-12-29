/**
 * Environment variable filtering utility
 *
 * Filters sensitive environment variables to prevent accidental
 * leakage to subprocesses (shell commands, MCP servers, etc.)
 */

/**
 * Patterns for identifying sensitive environment variables.
 * Uses specific patterns to avoid false positives with legitimate variables.
 */
export const SENSITIVE_ENV_PATTERNS = [
  /^.*_(API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY)(_.*)?$/i,
  /^(API_KEY|AUTH_TOKEN|SECRET_KEY|PRIVATE_KEY|PASSWORD|CREDENTIALS?)(_.*)?$/i,
  /^(AWS_SECRET|GITHUB_TOKEN|NPM_TOKEN|SSH_KEY|PGP_PASSPHRASE)(_.*)?$/i,
  /^.*_AUTH_(TOKEN|KEY|SECRET)(_.*)?$/i,
  /^(COOKIE|SESSION_ID|SESSION_SECRET)(_.*)?$/i,
];

/**
 * Check if an environment variable key matches sensitive patterns
 */
export function isSensitiveEnvKey(key: string): boolean {
  return SENSITIVE_ENV_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Filter sensitive environment variables from a host environment object
 * to prevent accidental leak of local secrets to subprocesses.
 *
 * @param env - Environment variables object (typically Bun.env or process.env)
 * @returns Filtered environment object with sensitive keys removed
 */
export function filterSensitiveEnv(
  env: Record<string, string | undefined>
): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (!isSensitiveEnvKey(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}
