export interface Logger {
  log(message: string): void;
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
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
  log(_message: string): void {}
  error(_message: string): void {}
  warn(_message: string): void {}
  info(_message: string): void {}
  debug(_message: string): void {}
}
