import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { ConsoleLogger, type Logger } from '../utils/logger.ts';

let sqliteSetupComplete = false;

/**
 * Setup SQLite with a custom library on macOS to support extensions.
 * This is idempotent - calling it multiple times is safe.
 */
export function setupSqlite(logger: Logger = new ConsoleLogger()): void {
  // Only run setup once
  if (sqliteSetupComplete) {
    return;
  }
  sqliteSetupComplete = true;

  // macOS typically comes with a system SQLite that doesn't support extensions
  // We need to try to load a custom one (e.g. from Homebrew) if on macOS
  if (process.platform === 'darwin') {
    try {
      // Common Homebrew paths for SQLite
      const paths = [
        '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib',
        '/usr/local/opt/sqlite/lib/libsqlite3.dylib',
        // Fallback to checking brew prefix if available
      ];

      // Try to find brew prefix dynamically if possible
      try {
        const proc = Bun.spawnSync(['brew', '--prefix', 'sqlite'], {
          stderr: 'ignore',
        });
        if (proc.success) {
          const prefix = proc.stdout.toString().trim();
          paths.unshift(`${prefix}/lib/libsqlite3.dylib`);
        }
      } catch {
        // Brew might not be installed or in path
      }

      for (const libPath of paths) {
        if (existsSync(libPath)) {
          logger.log(`[SqliteSetup] Using custom SQLite library: ${libPath}`);
          Database.setCustomSQLite(libPath);
          return;
        }
      }

      logger.warn(
        '[SqliteSetup] Warning: Could not find Homebrew SQLite. Extension loading might fail.'
      );
    } catch (error) {
      logger.warn(`[SqliteSetup] Failed to set custom SQLite: ${error}`);
    }
  }
}

/**
 * Reset SQLite setup state (mainly for testing).
 */
export function resetSqliteSetup(): void {
  sqliteSetupComplete = false;
}

/**
 * Check if SQLite setup has been completed.
 */
export function isSqliteSetupComplete(): boolean {
  return sqliteSetupComplete;
}
