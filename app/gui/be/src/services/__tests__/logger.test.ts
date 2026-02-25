import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, setLogLevel, getLogLevel } from '../logger.js';

describe('logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setLogLevel('debug');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel('info');
  });

  function parseOutput(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
    const call = spy.mock.calls[0];
    return JSON.parse(call[0] as string);
  }

  it('outputs valid JSON with required fields', () => {
    logger.info('test message');
    expect(logSpy).toHaveBeenCalledOnce();
    const entry = parseOutput(logSpy);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('test message');
    expect(typeof entry.timestamp).toBe('string');
    expect(new Date(entry.timestamp as string).toISOString()).toBe(entry.timestamp);
  });

  it('includes context fields in output', () => {
    logger.info('with context', { requestId: 'abc123', durationMs: 42 });
    const entry = parseOutput(logSpy);
    expect(entry.requestId).toBe('abc123');
    expect(entry.durationMs).toBe(42);
  });

  it('routes debug and info to console.log', () => {
    logger.debug('debug msg');
    logger.info('info msg');
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('routes warn to console.warn', () => {
    logger.warn('warning');
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('routes error to console.error', () => {
    logger.error('failure');
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(logSpy).not.toHaveBeenCalled();
  });

  describe('level filtering', () => {
    it('suppresses debug when level is info', () => {
      setLogLevel('info');
      logger.debug('hidden');
      logger.info('visible');
      expect(logSpy).toHaveBeenCalledOnce();
      const entry = parseOutput(logSpy);
      expect(entry.message).toBe('visible');
    });

    it('suppresses debug and info when level is warn', () => {
      setLogLevel('warn');
      logger.debug('hidden');
      logger.info('hidden');
      logger.warn('visible');
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('only logs errors when level is error', () => {
      setLogLevel('error');
      logger.debug('hidden');
      logger.info('hidden');
      logger.warn('hidden');
      logger.error('visible');
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledOnce();
    });
  });

  it('getLogLevel returns the current level', () => {
    setLogLevel('warn');
    expect(getLogLevel()).toBe('warn');
    setLogLevel('debug');
    expect(getLogLevel()).toBe('debug');
  });
});
