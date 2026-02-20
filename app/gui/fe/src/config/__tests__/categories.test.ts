import { describe, it, expect } from 'vitest';
import { getCategoryConfig, isCategoryEnabled, FILE_CATEGORIES, type FileCategory } from '../categories';

describe('categories', () => {
  it('getCategoryConfig text returns config with enabled: true', () => {
    const config = getCategoryConfig('text');
    expect(config).toBeDefined();
    expect(config!.enabled).toBe(true);
  });

  it('getCategoryConfig document returns config with enabled: false', () => {
    const config = getCategoryConfig('document');
    expect(config).toBeDefined();
    expect(config!.enabled).toBe(false);
  });

  it('isCategoryEnabled text is true', () => {
    expect(isCategoryEnabled('text')).toBe(true);
  });

  it('isCategoryEnabled video is false', () => {
    expect(isCategoryEnabled('video')).toBe(false);
  });

  it('getCategoryConfig with unknown string returns undefined', () => {
    const config = getCategoryConfig('unknown' as FileCategory);
    expect(config).toBeUndefined();
  });

  it('all FILE_CATEGORIES have unique IDs', () => {
    const ids = FILE_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all FILE_CATEGORIES have non-empty label, description, and acceptedExtensions array', () => {
    for (const cat of FILE_CATEGORIES) {
      expect(cat.label.length).toBeGreaterThan(0);
      expect(cat.description.length).toBeGreaterThan(0);
      expect(Array.isArray(cat.acceptedExtensions)).toBe(true);
    }
  });
});
