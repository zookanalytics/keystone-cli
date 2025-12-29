/**
 * Shell command executor
 *
 * ⚠️ SECURITY WARNING:
 * This executor runs shell commands using `sh -c`, which means:
 * - User inputs interpolated into commands can lead to command injection
 * - Malicious inputs like `foo; rm -rf /` will execute multiple commands
 *
 * IMPORTANT: Only run workflows from trusted sources.
 * Commands are executed with the same privileges as the Keystone process.
 * Expression evaluation happens before shell execution, so expressions
 * like ${{ inputs.filename }} are evaluated first, then passed to the shell.
 *
 * ✅ RECOMMENDED PRACTICE:
 * Use the escape() function to safely interpolate user inputs:
 *
 * steps:
 *   - id: safe_echo
 *     type: shell
 *     run: echo ${{ escape(inputs.user_message) }}
 *
 * The escape() function wraps arguments in single quotes and escapes any
 * single quotes within, preventing command injection attacks.
 */

import type { ExpressionContext } from '../../expression/evaluator.ts';
import { ExpressionEvaluator } from '../../expression/evaluator.ts';
import type { ShellStep } from '../../parser/schema.ts';
import { LIMITS } from '../../utils/constants.ts';
import { ConsoleLogger, type Logger } from '../../utils/logger.ts';
import { PathResolver } from '../../utils/paths.ts';
import type { StepResult } from './types.ts';

/**
 * Execute a shell step
 */
export async function executeShellStep(
  step: ShellStep,
  context: ExpressionContext,
  logger: Logger,
  dryRun?: boolean,
  abortSignal?: AbortSignal
): Promise<StepResult> {
  if (step.args) {
    const command = step.args.map((a) => ExpressionEvaluator.evaluateString(a, context)).join(' ');
    if (dryRun) {
      logger.log(`[DRY RUN] Would execute: ${command}`);
      return {
        output: { stdout: '[DRY RUN] Success', stderr: '', exitCode: 0 },
        status: 'success',
      };
    }

    const result = await executeShellArgs(step.args, context, logger, abortSignal, step.dir);
    return formatShellResult(result, logger);
  }

  if (!step.run) {
    throw new Error('Shell step must have either "run" or "args"');
  }

  // Strict Mode Check: Detect unescaped expressions in the raw template
  // We check if there are any ${{ }} blocks that don't start with escape(
  const hasUnescapedExpr = (s: string) => {
    // Finds ${{ ... }} blocks
    const matches = s.match(/\${{.*?}}/g);
    if (!matches) return false;

    // Check if the expression is strictly wrapped in escape(...)
    // Matches: ${{ escape(...) }} or ${{ escape( ... ) }}
    // Does NOT match: ${{ "foo" + escape(...) }}
    return matches.some((m) => {
      const content = m.slice(3, -2).trim(); // Remove ${{ and }}
      return !/^escape\s*\(.*\)$/.test(content);
    });
  };

  if (!step.allowInsecure && hasUnescapedExpr(step.run)) {
    throw new Error(
      `Security Error: Shell command contains unescaped expressions which are vulnerable to injection.\nUse \${{ escape(...) }} to safely interpolate values, or set 'allowInsecure: true' if you trust the source.\nCommand template: ${step.run}`
    );
  }

  const command = ExpressionEvaluator.evaluateString(step.run, context);
  if (!step.allowInsecure && detectShellInjectionRisk(command)) {
    throw new Error(
      `Security Error: Evaluated command contains shell metacharacters that require 'allowInsecure: true'.\n   Command: ${command.substring(0, 100)}${command.length > 100 ? '...' : ''}\n   Metacharacters detected. Please use 'allowInsecure: true' if this is intended.`
    );
  }

  const result = await executeShell(step, context, logger, abortSignal, command);
  return formatShellResult(result, logger);
}

/**
 * Format the internal ShellResult into a StepResult
 */
function formatShellResult(result: ShellResult, logger: Logger): StepResult {
  if (result.stdout) {
    logger.log(result.stdout.trim());
  }

  if (result.exitCode !== 0) {
    return {
      output: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        stdoutTruncated: result.stdoutTruncated,
        stderrTruncated: result.stderrTruncated,
      },
      status: 'failed',
      error: `Shell command exited with code ${result.exitCode}: ${result.stderr}`,
    };
  }

  return {
    output: {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
    },
    status: 'success',
  };
}

/**
 * Escape a shell argument for safe use in shell commands
 * Wraps the argument in single quotes and escapes any single quotes within
 *
 * Example usage in workflows:
 * ```yaml
 * steps:
 *   - id: safe_echo
 *     type: shell
 *     # Use this pattern to safely interpolate user inputs:
 *     run: echo ${{ escape(inputs.message) }}  # Safe: explicitly escaped
 *     # Avoid patterns like: sh -c "echo $USER_INPUT" where USER_INPUT is raw
 * ```
 */
export function escapeShellArg(arg: unknown): string {
  const value = arg === null || arg === undefined ? '' : String(arg);
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}

/**
 * Filter sensitive environment variables from host environment
 * to prevent accidental leak of local secrets to shell processes.
 */
function filterSensitiveEnv(env: Record<string, string | undefined>): Record<string, string> {
  const sensitivePatterns = [
    /^.*_(API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY)(_.*)?$/i,
    /^(API_KEY|AUTH_TOKEN|SECRET_KEY|PRIVATE_KEY|PASSWORD|CREDENTIALS?)(_.*)?$/i,
    /^(AWS_SECRET|GITHUB_TOKEN|NPM_TOKEN|SSH_KEY|PGP_PASSPHRASE)(_.*)?$/i,
    /^.*_AUTH_(TOKEN|KEY|SECRET)(_.*)?$/i,
    /^(COOKIE|SESSION_ID|SESSION_SECRET)(_.*)?$/i,
  ];

  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;

    const isSensitive = sensitivePatterns.some((pattern) => pattern.test(key));
    if (!isSensitive) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * Check if a command contains potentially dangerous shell metacharacters
 * Returns true if the command looks like it might contain unescaped user input
 */
/**
 * Strict validation of shell metacharacters to prevent injection.
 * Any character here triggers a security error if allowInsecure is false.
 * Note: We allow single and double quotes, as safe args parsing handles them.
 */
const SHELL_METACHARS = /[|&;<>\`$!\n*?=]/;

const TRUNCATED_SUFFIX = '... [truncated output]';

async function readStreamWithLimit(
  stream: ReadableStream<Uint8Array> | null | undefined,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  if (!stream) return { text: '', truncated: false };
  if (maxBytes <= 0) {
    try {
      await stream.cancel?.();
    } catch { }
    return { text: TRUNCATED_SUFFIX, truncated: true };
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytesRead = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;

    if (bytesRead + value.byteLength > maxBytes) {
      const allowed = maxBytes - bytesRead;
      if (allowed > 0) {
        text += decoder.decode(value.slice(0, allowed), { stream: true });
      }
      text += decoder.decode();
      try {
        await reader.cancel();
      } catch { }
      return { text: `${text}${TRUNCATED_SUFFIX}`, truncated: true };
    }

    bytesRead += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return { text, truncated: false };
}

export function detectShellInjectionRisk(rawCommand: string): boolean {
  // Legacy function for backward compatibility or future heuristic use
  // Now simply acts as a proxy for the metacharacter check
  return SHELL_METACHARS.test(rawCommand);
}

/**
 * Execute a shell command using Bun.spawn
 */
export async function executeShell(
  step: ShellStep,
  context: ExpressionContext,
  logger: Logger = new ConsoleLogger(),
  abortSignal?: AbortSignal,
  commandOverride?: string
): Promise<ShellResult> {
  if (abortSignal?.aborted) {
    throw new Error('Step canceled');
  }
  // Evaluate the command string
  const command = commandOverride ?? ExpressionEvaluator.evaluateString(step.run, context);

  // Check for potential shell injection risks (Early Check)
  // We double check here, though executeShellStep does it too, to catch direct calls
  if (!step.allowInsecure && detectShellInjectionRisk(command)) {
    throw new Error(
      `Security Error: Command contains shell metacharacters.\nCommand: "${command.substring(0, 100)}..."\nFix: Set 'allowInsecure: true' to enable shell features.`
    );
  }

  // Evaluate environment variables
  const env: Record<string, string> = context.env ? { ...context.env } : {};
  if (step.env) {
    for (const [key, value] of Object.entries(step.env)) {
      env[key] = ExpressionEvaluator.evaluateString(value, context);
    }
  }

  // Set working directory if specified
  const cwd = step.dir ? ExpressionEvaluator.evaluateString(step.dir, context) : undefined;
  if (cwd) {
    PathResolver.assertWithinCwd(cwd, step.allowOutsideCwd, 'Directory');
  }

  const hostEnv = filterSensitiveEnv(Bun.env);
  const mergedEnv = Object.keys(env).length > 0 ? { ...hostEnv, ...env } : hostEnv;

  // Shell metacharacters that require a real shell (including newlines, globs, env vars)
  const hasShellMetas = SHELL_METACHARS.test(command);

  // Common shell builtins that must run in a shell
  const firstWord = command.trim().split(/\s+/)[0];
  const isBuiltin = [
    'exit',
    'cd',
    'export',
    'unset',
    'source',
    '.',
    'alias',
    'unalias',
    'eval',
    'set',
    'true',
    'false',
  ].includes(firstWord);

  // Security Check: Enforce whitelist
  // If we haven't enabled insecure mode, we MUST be able to use spawn (no shell)
  if (!step.allowInsecure) {
    if (hasShellMetas || isBuiltin) {
      throw new Error(
        `Security Error: Command execution blocked.\nCommand: "${command.substring(0, 100)}${command.length > 100 ? '...' : ''
        }"\nReason: Contains shell metacharacters or builtin commands.\n` +
        `Fix: To use shell features (pipes, redirects, variables, etc.), you must set 'allowInsecure: true' in your step definition.`
      );
    }
  }

  const canUseSpawn = !hasShellMetas && !isBuiltin;

  try {
    let abortHandler: (() => void) | undefined;
    let stdoutString = '';
    let stderrString = '';
    let exitCode = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const maxOutputBytes = LIMITS.MAX_PROCESS_OUTPUT_BYTES;

    if (canUseSpawn) {
      // Split command into args without invoking a shell (handles quotes and escapes)
      const args: string[] = [];
      let current = '';
      let inQuote = false;
      let quoteChar = '';
      let escapeNext = false;
      let tokenStarted = false;

      for (let i = 0; i < command.length; i++) {
        const char = command[i];
        if (escapeNext) {
          current += char;
          tokenStarted = true;
          escapeNext = false;
          continue;
        }

        if (char === '\\' && quoteChar !== "'") {
          escapeNext = true;
          tokenStarted = true;
          continue;
        }

        if (char === "'" || char === '"') {
          if (inQuote && char === quoteChar) {
            inQuote = false;
            quoteChar = '';
          } else if (!inQuote) {
            inQuote = true;
            quoteChar = char;
          } else {
            current += char;
            tokenStarted = true;
          }
          tokenStarted = true;
          continue;
        }

        if (/\s/.test(char) && !inQuote) {
          if (tokenStarted) {
            args.push(current);
            current = '';
            tokenStarted = false;
          }
          continue;
        }

        current += char;
        tokenStarted = true;
      }
      if (escapeNext) {
        current += '\\';
        tokenStarted = true;
      }
      if (tokenStarted) args.push(current);

      if (args.length === 0) throw new Error('Empty command');

      const proc = Bun.spawn(args, {
        cwd,
        env: mergedEnv,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      abortHandler = () => {
        try {
          proc.kill();
        } catch { }
      };
      if (abortSignal) {
        abortSignal.addEventListener('abort', abortHandler, { once: true });
      }

      const stdoutPromise = readStreamWithLimit(proc.stdout, maxOutputBytes);
      const stderrPromise = readStreamWithLimit(proc.stderr, maxOutputBytes);

      // Wait for exit
      exitCode = await proc.exited;
      const [stdoutResult, stderrResult] = await Promise.all([stdoutPromise, stderrPromise]);
      stdoutString = stdoutResult.text;
      stderrString = stderrResult.text;
      stdoutTruncated = stdoutResult.truncated;
      stderrTruncated = stderrResult.truncated;
      if (abortSignal) {
        abortSignal.removeEventListener('abort', abortHandler);
      }
    } else {
      // Fallback to sh -c for complex commands (pipes, redirects, quotes)
      const proc = Bun.spawn(['sh', '-c', command], {
        cwd,
        env: mergedEnv,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      abortHandler = () => {
        try {
          proc.kill();
        } catch { }
      };
      if (abortSignal) {
        abortSignal.addEventListener('abort', abortHandler, { once: true });
      }

      const stdoutPromise = readStreamWithLimit(proc.stdout, maxOutputBytes);
      const stderrPromise = readStreamWithLimit(proc.stderr, maxOutputBytes);

      exitCode = await proc.exited;
      const [stdoutResult, stderrResult] = await Promise.all([stdoutPromise, stderrPromise]);
      stdoutString = stdoutResult.text;
      stderrString = stderrResult.text;
      stdoutTruncated = stdoutResult.truncated;
      stderrTruncated = stderrResult.truncated;
      if (abortSignal) {
        abortSignal.removeEventListener('abort', abortHandler);
      }
    }

    return {
      stdout: stdoutString,
      stderr: stderrString,
      exitCode,
      stdoutTruncated,
      stderrTruncated,
    };
  } catch (error) {
    if (abortSignal && abortHandler) {
      abortSignal.removeEventListener('abort', abortHandler);
    }
    // Handle shell execution errors (Bun throws ShellError with exitCode, stdout, stderr)
    if (error && typeof error === 'object' && 'exitCode' in error) {
      const shellError = error as {
        exitCode: number;
        stdout?: Buffer | string;
        stderr?: Buffer | string;
      };

      // Convert stdout/stderr to strings if they're buffers
      const stdout = shellError.stdout
        ? Buffer.isBuffer(shellError.stdout)
          ? shellError.stdout.toString()
          : String(shellError.stdout)
        : '';
      const stderr = shellError.stderr
        ? Buffer.isBuffer(shellError.stderr)
          ? shellError.stderr.toString()
          : String(shellError.stderr)
        : '';

      return {
        stdout,
        stderr,
        exitCode: shellError.exitCode,
      };
    }
    throw error;
  }
}

/**
 * Execute a command directly without a shell using an argument array
 */
export async function executeShellArgs(
  argsTemplates: string[],
  context: ExpressionContext,
  logger: Logger = new ConsoleLogger(),
  abortSignal?: AbortSignal,
  dir?: string
): Promise<ShellResult> {
  const args = argsTemplates.map((t) => ExpressionEvaluator.evaluateString(t, context));
  const cwd = dir ? ExpressionEvaluator.evaluateString(dir, context) : undefined;
  const env: Record<string, string> = context.env ? { ...context.env } : {};
  const hostEnv = filterSensitiveEnv(Bun.env);
  const mergedEnv = { ...hostEnv, ...env };
  const maxOutputBytes = LIMITS.MAX_PROCESS_OUTPUT_BYTES;

  const proc = Bun.spawn(args, {
    cwd,
    env: mergedEnv,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const abortHandler = () => {
    try {
      proc.kill();
    } catch { }
  };

  if (abortSignal) {
    abortSignal.addEventListener('abort', abortHandler, { once: true });
  }

  try {
    const stdoutPromise = readStreamWithLimit(proc.stdout, maxOutputBytes);
    const stderrPromise = readStreamWithLimit(proc.stderr, maxOutputBytes);

    const exitCode = await proc.exited;
    const [stdoutResult, stderrResult] = await Promise.all([stdoutPromise, stderrPromise]);

    if (abortSignal) {
      abortSignal.removeEventListener('abort', abortHandler);
    }

    return {
      stdout: stdoutResult.text,
      stderr: stderrResult.text,
      exitCode,
      stdoutTruncated: stdoutResult.truncated,
      stderrTruncated: stderrResult.truncated,
    };
  } finally {
    if (abortSignal) {
      abortSignal.removeEventListener('abort', abortHandler);
    }
  }
}
