import { describe, it, expect } from 'vitest';
import { getCategoryConfig, isCategoryEnabled, detectCategoryFromExtension, FILE_CATEGORIES, type FileCategory } from '../categories';

describe('categories', () => {
  it('getCategoryConfig text returns config with enabled: true', () => {
    const config = getCategoryConfig('text');
    expect(config).toBeDefined();
    expect(config!.enabled).toBe(true);
  });

  it('getCategoryConfig document returns config with enabled: true', () => {
    const config = getCategoryConfig('document');
    expect(config).toBeDefined();
    expect(config!.enabled).toBe(true);
  });

  it('isCategoryEnabled text is true', () => {
    expect(isCategoryEnabled('text')).toBe(true);
  });

  it('isCategoryEnabled video is true', () => {
    expect(isCategoryEnabled('video')).toBe(true);
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

  it('isCategoryEnabled returns false for unknown category', () => {
    expect(isCategoryEnabled('nonexistent' as FileCategory)).toBe(false);
  });

  describe('detectCategoryFromExtension', () => {
    it('returns "other" for filename with no extension', () => {
      expect(detectCategoryFromExtension('README')).toBe('other');
    });

    it('returns "other" for unknown extension', () => {
      expect(detectCategoryFromExtension('file.xyz123')).toBe('other');
    });

    it('detects document from .pdf', () => {
      expect(detectCategoryFromExtension('report.pdf')).toBe('document');
    });

    it('detects audio from .mp3', () => {
      expect(detectCategoryFromExtension('song.mp3')).toBe('audio');
    });

    it('detects image from .png', () => {
      expect(detectCategoryFromExtension('photo.png')).toBe('image');
    });

    it('detects video from .mp4', () => {
      expect(detectCategoryFromExtension('clip.mp4')).toBe('video');
    });

    it('handles bare extension input', () => {
      expect(detectCategoryFromExtension('.wav')).toBe('audio');
    });

    it('is case-insensitive', () => {
      expect(detectCategoryFromExtension('FILE.PDF')).toBe('document');
    });
  });
});
