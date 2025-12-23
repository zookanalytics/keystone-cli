import { ConsoleLogger, type Logger } from '../utils/logger.ts';

export function setupSqlite(logger: Logger = new ConsoleLogger()) {
  // macOS typically comes with a system SQLite that doesn't support extensions
  // We need to try to load a custom one (e.g. from Homebrew) if on macOS
  if (process.platform === 'darwin') {
    try {
      const { Database } = require('bun:sqlite');
      const { existsSync } = require('node:fs');

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

// Run setup immediately when imported
setupSqlite();
