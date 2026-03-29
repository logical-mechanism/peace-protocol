import { describe, it, expect } from 'vitest';
import { formatPrice, getCategoryLabel } from '../formatListing';

describe('formatPrice', () => {
  it('formats a valid lovelace amount', () => {
    expect(formatPrice(5_000_000)).toBe('5.00 ADA');
  });

  it('returns fallback for undefined', () => {
    expect(formatPrice(undefined)).toBe('No suggested price');
  });

  it('returns fallback for negative values', () => {
    expect(formatPrice(-1)).toBe('No suggested price');
  });

  it('returns fallback for NaN', () => {
    expect(formatPrice(NaN)).toBe('No suggested price');
  });

  it('formats zero as valid', () => {
    expect(formatPrice(0)).toBe('0.00 ADA');
  });
});

describe('getCategoryLabel', () => {
  it('capitalizes the category', () => {
    expect(getCategoryLabel('audio')).toBe('Audio');
  });

  it('defaults to Text when undefined', () => {
    expect(getCategoryLabel(undefined)).toBe('Text');
  });

  it('defaults to Text when empty string', () => {
    expect(getCategoryLabel('')).toBe('Text');
  });

  it('handles already-capitalized input', () => {
    expect(getCategoryLabel('Video')).toBe('Video');
  });
});
