import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test';
import type { GitStep } from '../../parser/schema.ts';
import { ConsoleLogger } from '../../utils/logger.ts';
import { executeGitStep } from './git-executor.ts';
import * as shellExecutor from './shell-executor.ts';

describe('git-executor', () => {
  const logger = new ConsoleLogger();
  const context = {
    env: {},
    inputs: {},
    steps: {},
  };

  let executeShellSpy: any;

  beforeEach(() => {
    executeShellSpy = spyOn(shellExecutor, 'executeShell').mockResolvedValue({
      stdout: 'git output',
      stderr: '',
      exitCode: 0,
    });
  });

  afterEach(() => {
    executeShellSpy.mockRestore();
  });

  it('should execute clone operation', async () => {
    const step: GitStep = {
      id: 'git-clone',
      type: 'git',
      op: 'clone',
      url: 'https://github.com/mhingston/keystone-cli.git',
      needs: [],
    };

    const result = await executeGitStep(step, context, logger);
    expect(result.status).toBe('success');
    expect(executeShellSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        run: 'git clone https://github.com/mhingston/keystone-cli.git ',
      }),
      context,
      logger,
      undefined,
      'git clone https://github.com/mhingston/keystone-cli.git '
    );
  });

  it('should execute clone with branch', async () => {
    const step: GitStep = {
      id: 'git-clone-branch',
      type: 'git',
      op: 'clone',
      url: 'https://github.com/mhingston/keystone-cli.git',
      branch: 'main',
      needs: [],
    };

    const result = await executeGitStep(step, context, logger);
    expect(result.status).toBe('success');
    expect(executeShellSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        run: 'git clone -b main https://github.com/mhingston/keystone-cli.git ',
      }),
      context,
      logger,
      undefined,
      'git clone -b main https://github.com/mhingston/keystone-cli.git '
    );
  });

  it('should execute worktree_add operation', async () => {
    const step: GitStep = {
      id: 'git-worktree-add',
      type: 'git',
      op: 'worktree_add',
      path: './tmp-worktree',
      branch: 'feature-branch',
      needs: [],
    };

    const result = await executeGitStep(step, context, logger);
    expect(result.status).toBe('success');
    expect((result.output as any).worktreePath).toBe('./tmp-worktree');
    expect(executeShellSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        run: 'git worktree add ./tmp-worktree feature-branch',
      }),
      context,
      logger,
      undefined,
      'git worktree add ./tmp-worktree feature-branch'
    );
  });

  it('should execute worktree_remove operation', async () => {
    const step: GitStep = {
      id: 'git-worktree-remove',
      type: 'git',
      op: 'worktree_remove',
      path: './tmp-worktree',
      needs: [],
    };

    const result = await executeGitStep(step, context, logger);
    expect(result.status).toBe('success');
    expect(executeShellSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        run: 'git worktree remove ./tmp-worktree',
      }),
      context,
      logger,
      undefined,
      'git worktree remove ./tmp-worktree'
    );
  });

  it('should execute checkout operation', async () => {
    const step: GitStep = {
      id: 'git-checkout',
      type: 'git',
      op: 'checkout',
      branch: 'main',
      needs: [],
    };

    const result = await executeGitStep(step, context, logger);
    expect(result.status).toBe('success');
    expect(executeShellSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        run: 'git checkout main',
      }),
      context,
      logger,
      undefined,
      'git checkout main'
    );
  });

  it('should execute pull operation', async () => {
    const step: GitStep = {
      id: 'git-pull',
      type: 'git',
      op: 'pull',
      branch: 'main',
      needs: [],
    };

    const result = await executeGitStep(step, context, logger);
    expect(result.status).toBe('success');
    expect(executeShellSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        run: 'git pull origin main',
      }),
      context,
      logger,
      undefined,
      'git pull origin main'
    );
  });

  it('should execute push operation', async () => {
    const step: GitStep = {
      id: 'git-push',
      type: 'git',
      op: 'push',
      branch: 'main',
      needs: [],
    };

    const result = await executeGitStep(step, context, logger);
    expect(result.status).toBe('success');
    expect(executeShellSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        run: 'git push origin main',
      }),
      context,
      logger,
      undefined,
      'git push origin main'
    );
  });

  it('should execute commit operation', async () => {
    const step: GitStep = {
      id: 'git-commit',
      type: 'git',
      op: 'commit',
      message: 'test commit',
      needs: [],
    };

    const result = await executeGitStep(step, context, logger);
    expect(result.status).toBe('success');
    expect(executeShellSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        run: 'git add . && git commit -m "test commit"',
      }),
      context,
      logger,
      undefined,
      'git add . && git commit -m "test commit"'
    );
  });

  it('should handle failed operations', async () => {
    executeShellSpy.mockResolvedValue({
      stdout: '',
      stderr: 'git error',
      exitCode: 1,
    });

    const step: GitStep = {
      id: 'git-fail',
      type: 'git',
      op: 'pull',
      needs: [],
    };

    const result = await executeGitStep(step, context, logger);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('Git pull failed with code 1: git error');
  });

  it('should throw error for missing url in clone', async () => {
    const step: GitStep = {
      id: 'git-clone-no-url',
      type: 'git',
      op: 'clone',
      needs: [],
    };

    await expect(executeGitStep(step, context, logger)).rejects.toThrow(
      'Git clone requires a "url"'
    );
  });

  it('should throw error for missing path in worktree_add', async () => {
    const step: GitStep = {
      id: 'git-worktree-no-path',
      type: 'git',
      op: 'worktree_add',
      needs: [],
    };

    await expect(executeGitStep(step, context, logger)).rejects.toThrow(
      'Git worktree_add requires a "path"'
    );
  });

  it('should throw error for missing branch in checkout', async () => {
    const step: GitStep = {
      id: 'git-checkout-no-branch',
      type: 'git',
      op: 'checkout',
      needs: [],
    };

    await expect(executeGitStep(step, context, logger)).rejects.toThrow(
      'Git checkout requires a "branch"'
    );
  });

  it('should throw error for missing message in commit', async () => {
    const step: GitStep = {
      id: 'git-commit-no-msg',
      type: 'git',
      op: 'commit',
      needs: [],
    };

    await expect(executeGitStep(step, context, logger)).rejects.toThrow(
      'Git commit requires a "message"'
    );
  });
});
