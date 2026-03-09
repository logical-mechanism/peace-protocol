import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatRelativeTime } from './time';

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for dates less than 60 seconds ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-01T12:00:30Z'));
    expect(formatRelativeTime('2025-06-01T12:00:00Z')).toBe('just now');
  });

  it('returns "just now" for the current time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-01T12:00:00Z'));
    expect(formatRelativeTime('2025-06-01T12:00:00Z')).toBe('just now');
  });

  it('returns minutes ago for dates less than 1 hour ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-01T12:25:00Z'));
    expect(formatRelativeTime('2025-06-01T12:00:00Z')).toBe('25m ago');
  });

  it('returns 1m ago at exactly 60 seconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-01T12:01:00Z'));
    expect(formatRelativeTime('2025-06-01T12:00:00Z')).toBe('1m ago');
  });

  it('returns hours ago for dates less than 1 day ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-01T15:00:00Z'));
    expect(formatRelativeTime('2025-06-01T12:00:00Z')).toBe('3h ago');
  });

  it('returns days ago for dates less than 30 days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-10T12:00:00Z'));
    expect(formatRelativeTime('2025-06-08T12:00:00Z')).toBe('2d ago');
  });

  it('returns months ago for dates less than 1 year ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-01T12:00:00Z'));
    expect(formatRelativeTime('2025-03-01T12:00:00Z')).toBe('3mo ago');
  });

  it('returns years ago for dates more than 1 year ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    expect(formatRelativeTime('2024-06-01T12:00:00Z')).toBe('2y ago');
  });

  it('returns "just now" for future dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-01T12:00:00Z'));
    expect(formatRelativeTime('2025-06-01T13:00:00Z')).toBe('just now');
  });

  it('handles boundary at 30 days (switches to months)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-07-01T12:00:00Z'));
    expect(formatRelativeTime('2025-06-01T12:00:00Z')).toBe('1mo ago');
  });

  it('handles boundary at 365 days (switches to years)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-02T12:00:00Z'));
    expect(formatRelativeTime('2025-06-01T12:00:00Z')).toBe('1y ago');
  });
});
