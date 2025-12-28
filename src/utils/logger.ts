/**
 * Standard logger interface for Keystone components.
 * 
 * Implementations should provide consistent formatting and respect 
 * global log levels where applicable.
 */
export interface Logger {
  /** Log general information/progress */
  log(message: string): void;
  /** Log error details */
  error(message: string): void;
  /** Log warnings about potentially problematic states */
  warn(message: string): void;
  /** Log informational messages */
  info(message: string): void;
  /** Log verbose debugging information. Optional to implement. */
  debug?(message: string): void;
}

export class ConsoleLogger implements Logger {
  log(message: string): void {
    console.log(message);
  }

  error(message: string): void {
    console.error(message);
  }

  warn(message: string): void {
    console.warn(message);
  }

  info(message: string): void {
    console.info(message);
  }

  debug(message: string): void {
    if (process.env.DEBUG || process.env.VERBOSE) {
      console.debug(message);
    }
  }
}

export class SilentLogger implements Logger {
  log(_message: string): void { }
  error(_message: string): void { }
  warn(_message: string): void { }
  info(_message: string): void { }
  debug(_message: string): void { }
}
