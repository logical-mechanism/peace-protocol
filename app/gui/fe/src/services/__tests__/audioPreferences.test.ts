import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAudioVolume, setAudioVolume,
  getAudioMuted, setAudioMuted,
  getAudioSpeed, setAudioSpeed,
} from '../audioPreferences';

beforeEach(() => {
  localStorage.clear();
});

describe('getAudioVolume / setAudioVolume', () => {
  it('returns 0.75 by default', () => {
    expect(getAudioVolume()).toBe(0.75);
  });

  it('persists and restores volume', () => {
    setAudioVolume(0.5);
    expect(getAudioVolume()).toBe(0.5);
  });

  it('clamps to [0, 1] on set', () => {
    setAudioVolume(1.5);
    expect(getAudioVolume()).toBe(1);
    setAudioVolume(-0.3);
    expect(getAudioVolume()).toBe(0);
  });

  it('returns default for invalid stored value', () => {
    localStorage.setItem('veiled_audio_volume', 'not-a-number');
    expect(getAudioVolume()).toBe(0.75);
  });

  it('returns default for out-of-range stored value', () => {
    localStorage.setItem('veiled_audio_volume', '5');
    expect(getAudioVolume()).toBe(0.75);
  });
});

describe('getAudioMuted / setAudioMuted', () => {
  it('returns false by default', () => {
    expect(getAudioMuted()).toBe(false);
  });

  it('persists and restores muted state', () => {
    setAudioMuted(true);
    expect(getAudioMuted()).toBe(true);
    setAudioMuted(false);
    expect(getAudioMuted()).toBe(false);
  });

  it('returns false for unexpected stored value', () => {
    localStorage.setItem('veiled_audio_muted', 'yes');
    expect(getAudioMuted()).toBe(false);
  });
});

describe('getAudioSpeed / setAudioSpeed', () => {
  it('returns 1.0 by default', () => {
    expect(getAudioSpeed()).toBe(1.0);
  });

  it('persists and restores speed', () => {
    setAudioSpeed(1.5);
    expect(getAudioSpeed()).toBe(1.5);
  });

  it('clamps to [0.5, 2.0] on set', () => {
    setAudioSpeed(3.0);
    expect(getAudioSpeed()).toBe(2.0);
    setAudioSpeed(0.1);
    expect(getAudioSpeed()).toBe(0.5);
  });

  it('returns default for invalid stored value', () => {
    localStorage.setItem('veiled_audio_speed', 'fast');
    expect(getAudioSpeed()).toBe(1.0);
  });

  it('returns default for out-of-range stored value', () => {
    localStorage.setItem('veiled_audio_speed', '10');
    expect(getAudioSpeed()).toBe(1.0);
  });
});
