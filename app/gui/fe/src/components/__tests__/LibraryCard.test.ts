import { describe, it, expect } from 'vitest';
import { getContentType } from '../LibraryCard';

describe('getContentType', () => {
  it('returns text for text category', () => {
    expect(getContentType('text')).toBe('text');
  });

  it('returns text for empty category', () => {
    expect(getContentType('')).toBe('text');
  });

  it('returns pdf for .pdf extension regardless of category', () => {
    expect(getContentType('document', '.pdf')).toBe('pdf');
    expect(getContentType('other', '.pdf')).toBe('pdf');
  });

  it('returns audio for audio extensions', () => {
    expect(getContentType('audio', '.mp3')).toBe('audio');
    expect(getContentType('document', '.flac')).toBe('audio');
    expect(getContentType('other', '.ogg')).toBe('audio');
    expect(getContentType('audio', '.wav')).toBe('audio');
    expect(getContentType('audio', '.aac')).toBe('audio');
    expect(getContentType('audio', '.m4a')).toBe('audio');
    expect(getContentType('audio', '.opus')).toBe('audio');
  });

  it('returns video for video extensions', () => {
    expect(getContentType('video', '.mp4')).toBe('video');
    expect(getContentType('other', '.mkv')).toBe('video');
    expect(getContentType('video', '.avi')).toBe('video');
    expect(getContentType('video', '.mov')).toBe('video');
    expect(getContentType('video', '.webm')).toBe('video');
    expect(getContentType('video', '.m4v')).toBe('video');
  });

  it('returns image for image extensions', () => {
    expect(getContentType('image', '.png')).toBe('image');
    expect(getContentType('other', '.jpg')).toBe('image');
    expect(getContentType('image', '.jpeg')).toBe('image');
    expect(getContentType('image', '.gif')).toBe('image');
    expect(getContentType('image', '.webp')).toBe('image');
    expect(getContentType('image', '.svg')).toBe('image');
    expect(getContentType('image', '.bmp')).toBe('image');
  });

  it('returns text for .csv and .txt extensions', () => {
    expect(getContentType('document', '.csv')).toBe('text');
    expect(getContentType('document', '.txt')).toBe('text');
  });

  it('handles case-insensitive extensions', () => {
    expect(getContentType('document', '.PDF')).toBe('pdf');
    expect(getContentType('audio', '.MP3')).toBe('audio');
    expect(getContentType('image', '.PNG')).toBe('image');
  });

  it('falls back to category when extension is unknown', () => {
    expect(getContentType('document', '.docx')).toBe('document');
    expect(getContentType('audio', '.xyz')).toBe('audio');
  });

  it('falls back to category when no extension provided', () => {
    expect(getContentType('document')).toBe('document');
    expect(getContentType('audio')).toBe('audio');
    expect(getContentType('video')).toBe('video');
    expect(getContentType('image')).toBe('image');
  });

  it('extension takes priority over mismatched category', () => {
    expect(getContentType('document', '.mp3')).toBe('audio');
    expect(getContentType('audio', '.png')).toBe('image');
    expect(getContentType('image', '.mp4')).toBe('video');
  });

  it('always returns text for text category regardless of extension', () => {
    expect(getContentType('text', '.pdf')).toBe('text');
    expect(getContentType('text', '.mp3')).toBe('text');
  });
});
