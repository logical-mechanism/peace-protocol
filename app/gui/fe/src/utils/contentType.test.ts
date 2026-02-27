import { describe, it, expect } from 'vitest';
import { getContentType } from './contentType';

describe('getContentType', () => {
  describe('category-based fallback', () => {
    it('returns "text" for text category', () => {
      expect(getContentType('text')).toBe('text');
    });

    it('returns "text" when category is empty string', () => {
      expect(getContentType('')).toBe('text');
    });

    it('returns category value for non-text categories without extension', () => {
      expect(getContentType('audio')).toBe('audio');
      expect(getContentType('video')).toBe('video');
      expect(getContentType('image')).toBe('image');
      expect(getContentType('document')).toBe('document');
      expect(getContentType('other')).toBe('other');
    });
  });

  describe('audio extensions', () => {
    const audioExts = ['.mp3', '.wav', '.flac', '.ogg', '.aac', '.m4a', '.opus'];

    it.each(audioExts)('returns "audio" for %s', (ext) => {
      expect(getContentType('other', ext)).toBe('audio');
    });

    it('is case insensitive', () => {
      expect(getContentType('other', '.MP3')).toBe('audio');
      expect(getContentType('other', '.Wav')).toBe('audio');
    });
  });

  describe('video extensions', () => {
    const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'];

    it.each(videoExts)('returns "video" for %s', (ext) => {
      expect(getContentType('other', ext)).toBe('video');
    });
  });

  describe('image extensions', () => {
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];

    it.each(imageExts)('returns "image" for %s', (ext) => {
      expect(getContentType('other', ext)).toBe('image');
    });
  });

  describe('pdf extension', () => {
    it('returns "pdf" for .pdf', () => {
      expect(getContentType('document', '.pdf')).toBe('pdf');
    });
  });

  describe('text extensions', () => {
    it('returns "text" for .csv', () => {
      expect(getContentType('document', '.csv')).toBe('text');
    });

    it('returns "text" for .txt', () => {
      expect(getContentType('document', '.txt')).toBe('text');
    });
  });

  describe('unknown extension falls back to category', () => {
    it('returns category for unrecognized extension', () => {
      expect(getContentType('document', '.xyz')).toBe('document');
    });

    it('returns "other" for unrecognized extension with "other" category', () => {
      expect(getContentType('other', '.xyz')).toBe('other');
    });
  });

  describe('extension takes priority over category', () => {
    it('audio extension overrides non-audio category', () => {
      expect(getContentType('document', '.mp3')).toBe('audio');
    });

    it('video extension overrides non-video category', () => {
      expect(getContentType('image', '.mp4')).toBe('video');
    });
  });
});
