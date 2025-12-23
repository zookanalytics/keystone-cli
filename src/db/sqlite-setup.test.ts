import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { Logger } from '../utils/logger';
import { setupSqlite } from './sqlite-setup';

describe('setupSqlite', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
  });

  it('does nothing on non-darwin platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const logger: Logger = {
      log: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
    };
    setupSqlite(logger);
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs warning if no custom sqlite found on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const logger: Logger = {
      log: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
    };

    // Mock Bun.spawnSync for brew
    const spawnSpy = spyOn(Bun, 'spawnSync').mockImplementation(
      () => ({ success: false }) as unknown as ReturnType<typeof Bun.spawnSync>
    );

    try {
      setupSqlite(logger);
    } finally {
      spawnSpy.mockRestore();
    }
  });
});
