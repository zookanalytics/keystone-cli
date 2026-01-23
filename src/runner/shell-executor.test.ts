import { describe, expect, it } from 'bun:test';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve as resolvePath, sep } from 'node:path';
import type { ExpressionContext } from '../expression/evaluator';
import { ConfigSchema } from '../parser/config-schema';
import type { ShellStep } from '../parser/schema';
import { ConfigLoader } from '../utils/config-loader';
import { ConsoleLogger } from '../utils/logger';
import { escapeShellArg, executeShell, executeShellStep } from './executors/shell-executor.ts';

describe('shell-executor', () => {
  const logger = new ConsoleLogger();

  describe('escapeShellArg', () => {
    it('should wrap in single quotes', () => {
      expect(escapeShellArg('hello')).toBe("'hello'");
    });

    it('should escape single quotes', () => {
      expect(escapeShellArg("don't")).toBe("'don'\\''t'");
    });
  });

  describe('executeShell', () => {
    const context: ExpressionContext = {
      inputs: {},
      steps: {},
      env: {},
    };

    it('should execute a simple command', async () => {
      const step: ShellStep = {
        id: 'test',
        type: 'shell',
        needs: [],
        run: 'echo "hello world"',
      };

      const result = await executeShell(step, context);
      expect(result.stdout.trim()).toBe('hello world');
      expect(result.exitCode).toBe(0);
    });

    it('should evaluate expressions in the command', async () => {
      const step: ShellStep = {
        id: 'test',
        type: 'shell',
        needs: [],
        run: 'echo "${{ inputs.name }}"',
      };
      const customContext: ExpressionContext = {
        ...context,
        inputs: { name: 'world' },
      };

      const result = await executeShell(step, customContext);
      expect(result.stdout.trim()).toBe('world');
    });

    it('should handle environment variables', async () => {
      const step: ShellStep = {
        id: 'test',
        type: 'shell',
        needs: [],
        run: 'echo $TEST_VAR',
        env: {
          TEST_VAR: 'env-value',
        },
      };

      const result = await executeShell(step, context);
      expect(result.stdout.trim()).toBe('env-value');
    });

    it('should handle working directory', async () => {
      const step: ShellStep = {
        id: 'test',
        type: 'shell',
        needs: [],
        run: 'pwd',
        dir: '/tmp',
        allowOutsideCwd: true,
      };

      const result = await executeShell(step, context);
      expect(result.stdout.trim()).toMatch(/\/tmp$/);
    });

    it('should capture stderr', async () => {
      const step: ShellStep = {
        id: 'test',
        type: 'shell',
        needs: [],
        run: 'echo "error" >&2',
      };

      const result = await executeShell(step, context);
      expect(result.stderr.trim()).toBe('error');
    });

    it('should handle non-zero exit codes', async () => {
      const step: ShellStep = {
        id: 'test',
        type: 'shell',
        needs: [],
        run: 'exit 1',
      };

      const result = await executeShell(step, context);
      expect(result.exitCode).toBe(1);
    });

    it('should allow shell commands with semicolons', async () => {
      const step: ShellStep = {
        id: 'test',
        type: 'shell',
        needs: [],
        run: 'echo "hello" ; echo "world"',
      };

      // Semicolons are allowed (denylist check is for dangerous commands, not syntax)
      const result = await executeShell(step, context);
      expect(result.exitCode).toBe(0);
    });

    it('should allow shell variable expansion like ${HOME}', async () => {
      const step: ShellStep = {
        id: 'test',
        type: 'shell',
        needs: [],
        run: 'echo ${HOME}',
      };

      // Should NOT throw - ${HOME} is legitimate
      const result = await executeShell(step, context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(Bun.env.HOME || '');
    });

    it('should allow parameter expansion like ${IFS}', async () => {
      const step: ShellStep = {
        id: 'test',
        type: 'shell',
        needs: [],
        run: 'echo ${IFS}',
      };

      // ${IFS} is allowed (no active injection detection beyond denylist)
      const result = await executeShell(step, context);
      expect(result.exitCode).toBe(0);
    });

    it('should allow braces and quotes for JSON usage', async () => {
      // {} and quotes for JSON handling
      const step: ShellStep = {
        id: 'test',
        type: 'shell',
        needs: [],
        run: 'echo \'{"values": [1, 2, 3]}\'',
      };

      const result = await executeShell(step, context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('{"values": [1, 2, 3]}');
    });

    it('should allow flow control with semicolons', async () => {
      const step: ShellStep = {
        id: 'test',
        type: 'shell',
        needs: [],
        run: 'if [ "1" = "1" ]; then echo "match"; fi',
      };

      const result = await executeShell(step, context);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('match');
    });
  });

  describe('executeShellStep (args)', () => {
    const context: ExpressionContext = {
      inputs: {},
      steps: {},
      env: {},
    };

    it('should reject empty args', async () => {
      const step: ShellStep = {
        id: 'test',
        type: 'shell',
        needs: [],
        args: [],
      };

      await expect(executeShellStep(step, context, logger)).rejects.toThrow(
        /args must contain at least one element/
      );
    });

    it('should apply step env for args execution', async () => {
      const bunPath = process.execPath;
      const step: ShellStep = {
        id: 'test',
        type: 'shell',
        needs: [],
        args: [bunPath, '-e', 'console.log(process.env.TEST_VAR ?? "")'],
        env: { TEST_VAR: 'args-env' },
      };

      const result = await executeShellStep(step, context, logger);
      expect(result.output?.stdout?.trim()).toBe('args-env');
    });

    it('should enforce denylist for args execution', async () => {
      const bunPath = process.execPath;
      const denied = basename(bunPath);

      ConfigLoader.setConfig(
        ConfigSchema.parse({
          engines: { denylist: [denied] },
        })
      );

      try {
        const step: ShellStep = {
          id: 'test',
          type: 'shell',
          needs: [],
          args: [bunPath, '-e', 'console.log("nope")'],
        };

        await expect(executeShellStep(step, context, logger)).rejects.toThrow(/denylist/);
      } finally {
        ConfigLoader.clear();
      }
    });

    it('should enforce allowOutsideCwd for args execution', async () => {
      const bunPath = process.execPath;
      const cwd = resolvePath(process.cwd());
      let outsideDir = resolvePath(tmpdir());

      if (outsideDir.startsWith(`${cwd}${sep}`)) {
        const parent = resolvePath(cwd, '..');
        if (parent !== cwd) {
          outsideDir = parent;
        }
      }

      if (outsideDir === cwd) {
        return;
      }

      const step: ShellStep = {
        id: 'test',
        type: 'shell',
        needs: [],
        args: [bunPath, '-e', 'console.log(process.cwd())'],
        dir: outsideDir,
      };

      await expect(executeShellStep(step, context, logger)).rejects.toThrow(
        /outside the project directory/
      );

      const allowedStep: ShellStep = {
        ...step,
        allowOutsideCwd: true,
      };

      const result = await executeShellStep(allowedStep, context, logger);
      const resolvedOutput = realpathSync(resolvePath(result.output?.stdout?.trim() || ''));
      const resolvedOutside = realpathSync(outsideDir);
      expect(resolvedOutput).toBe(resolvedOutside);
    });
  });
});
