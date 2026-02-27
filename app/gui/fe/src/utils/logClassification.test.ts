import { describe, it, expect } from 'vitest';
import { getLogLineClass } from './logClassification';

describe('getLogLineClass', () => {
  describe('error severity', () => {
    it('returns error class for "error"', () => {
      expect(getLogLineClass('connection error occurred')).toBe('text-[var(--error)]');
    });

    it('returns error class for "fatal"', () => {
      expect(getLogLineClass('fatal: process terminated')).toBe('text-[var(--error)]');
    });

    it('returns error class for "panic"', () => {
      expect(getLogLineClass('panic in thread main')).toBe('text-[var(--error)]');
    });

    it('is case insensitive', () => {
      expect(getLogLineClass('ERROR: something broke')).toBe('text-[var(--error)]');
      expect(getLogLineClass('FATAL EXCEPTION')).toBe('text-[var(--error)]');
      expect(getLogLineClass('PANIC at the disco')).toBe('text-[var(--error)]');
    });
  });

  describe('warning severity', () => {
    it('returns warning class for "[stderr]"', () => {
      expect(getLogLineClass('[stderr] some output')).toBe('text-[var(--warning)]');
    });

    it('returns warning class for "warn"', () => {
      expect(getLogLineClass('warn: deprecated function')).toBe('text-[var(--warning)]');
    });

    it('is case insensitive', () => {
      expect(getLogLineClass('[STDERR] output')).toBe('text-[var(--warning)]');
      expect(getLogLineClass('WARN: check config')).toBe('text-[var(--warning)]');
    });
  });

  describe('default severity', () => {
    it('returns secondary text class for normal log lines', () => {
      expect(getLogLineClass('info: server started on port 3001')).toBe('text-[var(--text-secondary)]');
    });

    it('returns secondary text class for empty string', () => {
      expect(getLogLineClass('')).toBe('text-[var(--text-secondary)]');
    });
  });

  describe('priority: error over warning', () => {
    it('returns error when line contains both error and warn', () => {
      expect(getLogLineClass('[stderr] error: something failed')).toBe('text-[var(--error)]');
    });
  });
});
