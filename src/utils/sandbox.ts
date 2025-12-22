/**
 * Sandbox for executing untrusted script code.
 *
 * ⚠️ IMPORTANT: Bun Runtime Compatibility
 *
 * This project runs on Bun, which uses JavaScriptCore (JSC), NOT V8.
 * The `isolated-vm` package binds to V8's C++ API and CANNOT work with Bun.
 *
 * As a result, we use Node.js's built-in `vm` module (which Bun implements
 * via a compatibility layer). This provides basic sandboxing but is NOT
 * secure against determined attackers.
 *
 * SECURITY IMPLICATIONS:
 * - The `vm` module does NOT provide true isolation
 * - Malicious code could potentially escape the sandbox
 * - Only run workflows/scripts from TRUSTED sources
 *
 * For production use with untrusted code, consider:
 * 1. Running in a separate subprocess with OS-level isolation
 * 2. Using containers or VMs for full isolation
 * 3. Running on Node.js with isolated-vm instead of Bun
 */

import * as vm from 'node:vm';

export interface SandboxOptions {
  timeout?: number;
  memoryLimit?: number; // Note: memoryLimit is not enforced by node:vm
}

export class SafeSandbox {
  private static warned = false;

  /**
   * Execute a script in a sandbox.
   *
   * Note: On Bun, this uses node:vm which provides basic isolation but
   * is not secure against malicious code. Only run trusted scripts.
   */
  static async execute(
    code: string,
    context: Record<string, unknown> = {},
    options: SandboxOptions = {}
  ): Promise<unknown> {
    // Show warning once per process
    if (!SafeSandbox.warned) {
      console.warn(
        '\n⚠️  SECURITY WARNING: Using Bun/Node.js built-in VM for script execution.\n' +
          '   This sandbox is NOT secure against malicious code.\n' +
          '   Only run workflows from trusted sources.\n'
      );
      SafeSandbox.warned = true;
    }

    const sandbox = { ...context };
    return vm.runInNewContext(code, sandbox, {
      timeout: options.timeout || 5000,
      displayErrors: true,
    });
  }

  /**
   * Reset the warning state (useful for testing)
   */
  static resetWarning(): void {
    SafeSandbox.warned = false;
  }
}
