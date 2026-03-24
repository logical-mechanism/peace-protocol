import { describe, it, expect, beforeEach } from 'vitest';
import {
  getVideoVolume, setVideoVolume,
  getVideoMuted, setVideoMuted,
  getVideoSpeed, setVideoSpeed,
} from '../videoPreferences';

beforeEach(() => {
  localStorage.clear();
});

describe('getVideoVolume / setVideoVolume', () => {
  it('returns 1.0 by default', () => {
    expect(getVideoVolume()).toBe(1.0);
  });

  it('persists and restores volume', () => {
    setVideoVolume(0.5);
    expect(getVideoVolume()).toBe(0.5);
  });

  it('clamps to [0, 1] on set', () => {
    setVideoVolume(1.5);
    expect(getVideoVolume()).toBe(1);
    setVideoVolume(-0.3);
    expect(getVideoVolume()).toBe(0);
  });

  it('returns default for invalid stored value', () => {
    localStorage.setItem('veiled_video_volume', 'not-a-number');
    expect(getVideoVolume()).toBe(1.0);
  });

  it('returns default for out-of-range stored value', () => {
    localStorage.setItem('veiled_video_volume', '5');
    expect(getVideoVolume()).toBe(1.0);
  });
});

describe('getVideoMuted / setVideoMuted', () => {
  it('returns false by default', () => {
    expect(getVideoMuted()).toBe(false);
  });

  it('persists and restores muted state', () => {
    setVideoMuted(true);
    expect(getVideoMuted()).toBe(true);
    setVideoMuted(false);
    expect(getVideoMuted()).toBe(false);
  });

  it('returns false for unexpected stored value', () => {
    localStorage.setItem('veiled_video_muted', 'yes');
    expect(getVideoMuted()).toBe(false);
  });
});

describe('getVideoSpeed / setVideoSpeed', () => {
  it('returns 1.0 by default', () => {
    expect(getVideoSpeed()).toBe(1.0);
  });

  it('persists and restores speed', () => {
    setVideoSpeed(1.5);
    expect(getVideoSpeed()).toBe(1.5);
  });

  it('clamps to [0.5, 2.0] on set', () => {
    setVideoSpeed(3.0);
    expect(getVideoSpeed()).toBe(2.0);
    setVideoSpeed(0.1);
    expect(getVideoSpeed()).toBe(0.5);
  });

  it('returns default for invalid stored value', () => {
    localStorage.setItem('veiled_video_speed', 'fast');
    expect(getVideoSpeed()).toBe(1.0);
  });

  it('returns default for out-of-range stored value', () => {
    localStorage.setItem('veiled_video_speed', '10');
    expect(getVideoSpeed()).toBe(1.0);
  });
});
