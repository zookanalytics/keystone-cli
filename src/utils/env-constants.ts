/**
 * Constants related to environment variables and security configuration.
 */

/**
 * Prefixes for environment variables that should be automatically loaded as secrets.
 * This is a security feature to prevent sensitive environment variables from being
 * inadvertantly exposed if they don't match these patterns.
 */
export const AUTO_LOAD_SECRET_PREFIXES = [
  'KEYSTONE_',
  'SECRET_',
  'GITHUB_',
  'OPENAI_',
  'ANTHROPIC_',
  'GEMINI_',
  'GOOGLE_',
  'AWS_',
] as const;
