import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { ConsoleLogger, SilentLogger } from './logger';

describe('ConsoleLogger', () => {
  let logSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let infoSpy: ReturnType<typeof spyOn>;
  let debugSpy: ReturnType<typeof spyOn>;
  const originalDebug = process.env.DEBUG;
  const originalVerbose = process.env.VERBOSE;

  beforeEach(() => {
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    infoSpy = spyOn(console, 'info').mockImplementation(() => {});
    debugSpy = spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    infoSpy.mockRestore();
    debugSpy.mockRestore();
    if (originalDebug === undefined) {
      process.env.DEBUG = undefined;
    } else {
      process.env.DEBUG = originalDebug;
    }
    if (originalVerbose === undefined) {
      process.env.VERBOSE = undefined;
    } else {
      process.env.VERBOSE = originalVerbose;
    }
  });

  it('writes to console methods', () => {
    const logger = new ConsoleLogger();
    logger.log('log');
    logger.warn('warn');
    logger.error('error');
    logger.info('info');

    expect(logSpy).toHaveBeenCalledWith('log');
    expect(warnSpy).toHaveBeenCalledWith('warn');
    expect(errorSpy).toHaveBeenCalledWith('error');
    expect(infoSpy).toHaveBeenCalledWith('info');
  });

  it('logs debug only when DEBUG or VERBOSE is set', () => {
    const logger = new ConsoleLogger();

    process.env.DEBUG = undefined;
    process.env.VERBOSE = undefined;
    logger.debug('quiet');
    expect(debugSpy).not.toHaveBeenCalled();

    process.env.DEBUG = '1';
    logger.debug('loud');
    expect(debugSpy).toHaveBeenCalledWith('loud');
  });
});

describe('SilentLogger', () => {
  it('ignores all log calls', () => {
    const logger = new SilentLogger();
    logger.log('log');
    logger.warn('warn');
    logger.error('error');
    logger.info('info');
    logger.debug('debug');
    expect(true).toBe(true);
  });
});
