import { describe, it, expect } from 'vitest';
import {
  getCategoryConfig,
  isCategoryEnabled,
  detectCategoryFromExtension,
  getTopLevelCategory,
  buildCategoryPath,
  getCategoryPathLabel,
  categoryMatchesFilter,
  getSubcategories,
  findSubcategory,
  getAllSubcategories,
  FILE_CATEGORIES,
  type FileCategory,
} from '../categories';

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

  describe('getTopLevelCategory', () => {
    it('returns first segment from colon-delimited path', () => {
      expect(getTopLevelCategory('audio:music')).toBe('audio');
    });

    it('returns the bare category when no colon present', () => {
      expect(getTopLevelCategory('video')).toBe('video');
    });

    it('handles deeply nested paths', () => {
      expect(getTopLevelCategory('image:photo:landscape')).toBe('image');
    });
  });

  describe('buildCategoryPath', () => {
    it('joins category and subcategory with colon', () => {
      expect(buildCategoryPath('audio', 'music')).toBe('audio:music');
    });

    it('returns bare category when no subcategory provided', () => {
      expect(buildCategoryPath('document')).toBe('document');
    });

    it('returns bare category when subcategory is empty string', () => {
      expect(buildCategoryPath('image', '')).toBe('image');
    });
  });

  describe('getCategoryPathLabel', () => {
    it('returns "Audio > Music" for audio:music', () => {
      expect(getCategoryPathLabel('audio:music')).toBe('Audio > Music');
    });

    it('returns bare label for top-level category', () => {
      expect(getCategoryPathLabel('video')).toBe('Video');
    });

    it('returns raw path for unknown top-level category', () => {
      expect(getCategoryPathLabel('unknown')).toBe('unknown');
    });

    it('falls back to raw subcategory id when subcategory not found', () => {
      expect(getCategoryPathLabel('audio:nonexistent')).toBe('Audio > nonexistent');
    });

    it('returns 3-level label for genre path', () => {
      expect(getCategoryPathLabel('audio:music:rock')).toBe('Audio > Music > Rock');
    });

    it('falls back to raw genre id when genre not found', () => {
      expect(getCategoryPathLabel('audio:music:nonexistent')).toBe('Audio > Music > nonexistent');
    });

    it('handles video:film genre path', () => {
      expect(getCategoryPathLabel('video:film:horror')).toBe('Video > Film > Horror');
    });
  });

  describe('categoryMatchesFilter', () => {
    it('"all" matches everything', () => {
      expect(categoryMatchesFilter('audio:music', 'all')).toBe(true);
      expect(categoryMatchesFilter('video', 'all')).toBe(true);
    });

    it('exact match works', () => {
      expect(categoryMatchesFilter('audio:music', 'audio:music')).toBe(true);
    });

    it('top-level filter matches sub-categories via startsWith', () => {
      expect(categoryMatchesFilter('audio:music', 'audio')).toBe(true);
      expect(categoryMatchesFilter('audio:podcast', 'audio')).toBe(true);
    });

    it('sub-category filter does not match parent', () => {
      expect(categoryMatchesFilter('audio', 'audio:music')).toBe(false);
    });

    it('unrelated categories do not match', () => {
      expect(categoryMatchesFilter('video:film', 'audio')).toBe(false);
    });
  });

  describe('getSubcategories', () => {
    it('returns subcategories for a known category', () => {
      const subs = getSubcategories('audio');
      expect(subs.length).toBeGreaterThan(0);
      expect(subs.some((s) => s.id === 'music')).toBe(true);
    });

    it('returns empty array for unknown category', () => {
      expect(getSubcategories('nonexistent' as FileCategory)).toEqual([]);
    });
  });

  describe('findSubcategory', () => {
    it('finds a subcategory by ID', () => {
      const sub = findSubcategory('audio', 'music');
      expect(sub).toBeDefined();
      expect(sub!.label).toBe('Music');
    });

    it('returns undefined for a missing subcategory', () => {
      expect(findSubcategory('audio', 'nonexistent')).toBeUndefined();
    });

    it('returns undefined for an unknown parent category', () => {
      expect(findSubcategory('nonexistent' as FileCategory, 'music')).toBeUndefined();
    });
  });

  describe('getAllSubcategories', () => {
    it('returns a flat array of all subcategories across categories', () => {
      const all = getAllSubcategories();
      expect(all.length).toBeGreaterThan(0);

      // Every entry has categoryId and subcategory
      for (const entry of all) {
        expect(entry.categoryId).toBeDefined();
        expect(entry.subcategory.id).toBeDefined();
        expect(entry.subcategory.label).toBeDefined();
      }
    });

    it('includes subcategories from multiple categories', () => {
      const all = getAllSubcategories();
      const categoryIds = new Set(all.map((e) => e.categoryId));
      // At least audio, image, video should be present
      expect(categoryIds.has('audio')).toBe(true);
      expect(categoryIds.has('image')).toBe(true);
      expect(categoryIds.has('video')).toBe(true);
    });

    it('total count matches sum of all category subcategories', () => {
      const all = getAllSubcategories();
      const expectedCount = FILE_CATEGORIES.reduce((sum, cat) => sum + (cat.subcategories?.length ?? 0), 0);
      expect(all.length).toBe(expectedCount);
    });
  });
});
