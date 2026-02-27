import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime } from '../formatDate';

describe('formatDate', () => {
  it('formats an ISO date string as short date', () => {
    const result = formatDate('2026-01-15T10:30:00Z');
    // Locale-dependent, but should contain month, day, year
    expect(result).toContain('Jan');
    expect(result).toContain('15');
    expect(result).toContain('2026');
  });

  it('handles different months', () => {
    expect(formatDate('2025-12-25T12:00:00Z')).toContain('Dec');
    expect(formatDate('2025-06-15T12:00:00Z')).toContain('Jun');
  });

  it('handles date-only strings', () => {
    const result = formatDate('2025-03-10');
    expect(result).toContain('Mar');
    expect(result).toContain('2025');
  });
});

describe('formatDateTime', () => {
  it('formats an ISO date string with time', () => {
    const result = formatDateTime('2026-01-15T10:30:00Z');
    expect(result).toContain('Jan');
    expect(result).toContain('15');
    expect(result).toContain('2026');
    // Should include time portion (locale-dependent format)
    expect(result.length).toBeGreaterThan(formatDate('2026-01-15T10:30:00Z').length);
  });

  it('returns empty string for undefined', () => {
    expect(formatDateTime(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatDateTime('')).toBe('');
  });
});
