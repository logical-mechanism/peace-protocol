import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeVideoKey,
  getResumePosition,
  setResumePosition,
  clearResumePosition,
} from '../videoResumeStorage';

beforeEach(() => {
  localStorage.clear();
});

describe('normalizeVideoKey', () => {
  it('strips the media server URL prefix', () => {
    expect(normalizeVideoKey('http://127.0.0.1:54321/media/content/video/abc/file.mp4'))
      .toBe('media/content/video/abc/file.mp4');
  });

  it('handles different port numbers', () => {
    const a = normalizeVideoKey('http://127.0.0.1:12345/media/content/video/abc/file.mp4');
    const b = normalizeVideoKey('http://127.0.0.1:99999/media/content/video/abc/file.mp4');
    expect(a).toBe(b);
  });

  it('returns path unchanged if no prefix match', () => {
    expect(normalizeVideoKey('/some/path.mp4')).toBe('/some/path.mp4');
  });
});

describe('getResumePosition / setResumePosition', () => {
  it('returns null when no position stored', () => {
    expect(getResumePosition('media/content/video/abc/file.mp4')).toBeNull();
  });

  it('stores and retrieves a resume position', () => {
    setResumePosition('media/video/abc.mp4', 30, 100);
    expect(getResumePosition('media/video/abc.mp4')).toBe(30);
  });

  it('does not store position below 5% of duration', () => {
    setResumePosition('video.mp4', 2, 100); // 2%
    expect(getResumePosition('video.mp4')).toBeNull();
  });

  it('does not store position above 95% of duration', () => {
    setResumePosition('video.mp4', 96, 100); // 96%
    expect(getResumePosition('video.mp4')).toBeNull();
  });

  it('stores position at exactly 5%', () => {
    setResumePosition('video.mp4', 5, 100);
    expect(getResumePosition('video.mp4')).toBe(5);
  });

  it('stores position at exactly 95%', () => {
    setResumePosition('video.mp4', 95, 100);
    expect(getResumePosition('video.mp4')).toBe(95);
  });

  it('ignores invalid duration', () => {
    setResumePosition('video.mp4', 30, 0);
    expect(getResumePosition('video.mp4')).toBeNull();
    setResumePosition('video.mp4', 30, -10);
    expect(getResumePosition('video.mp4')).toBeNull();
    setResumePosition('video.mp4', 30, Infinity);
    expect(getResumePosition('video.mp4')).toBeNull();
  });

  it('ignores invalid time', () => {
    setResumePosition('video.mp4', NaN, 100);
    expect(getResumePosition('video.mp4')).toBeNull();
    setResumePosition('video.mp4', Infinity, 100);
    expect(getResumePosition('video.mp4')).toBeNull();
  });

  it('updates existing entry', () => {
    setResumePosition('video.mp4', 30, 100);
    setResumePosition('video.mp4', 60, 100);
    expect(getResumePosition('video.mp4')).toBe(60);
  });

  it('evicts oldest entries when exceeding max', () => {
    // Store 51 entries (max is 50)
    for (let i = 0; i < 51; i++) {
      setResumePosition(`video-${i}.mp4`, 50, 100);
    }
    // The first entry should have been evicted
    expect(getResumePosition('video-0.mp4')).toBeNull();
    // The last entry should still exist
    expect(getResumePosition('video-50.mp4')).toBe(50);
  });
});

describe('clearResumePosition', () => {
  it('removes a stored position', () => {
    setResumePosition('video.mp4', 30, 100);
    clearResumePosition('video.mp4');
    expect(getResumePosition('video.mp4')).toBeNull();
  });

  it('handles clearing non-existent key', () => {
    expect(() => clearResumePosition('nonexistent.mp4')).not.toThrow();
  });

  it('does not affect other entries', () => {
    setResumePosition('a.mp4', 30, 100);
    setResumePosition('b.mp4', 60, 100);
    clearResumePosition('a.mp4');
    expect(getResumePosition('a.mp4')).toBeNull();
    expect(getResumePosition('b.mp4')).toBe(60);
  });
});

describe('corrupted localStorage', () => {
  it('returns null for corrupted data', () => {
    localStorage.setItem('veiled_video_resume', 'not-json');
    expect(getResumePosition('video.mp4')).toBeNull();
  });

  it('overwrites corrupted data on save', () => {
    localStorage.setItem('veiled_video_resume', 'not-json');
    setResumePosition('video.mp4', 30, 100);
    expect(getResumePosition('video.mp4')).toBe(30);
  });
});
