import { storageGet, storageSet } from './storageUtils';

const VOLUME_KEY = 'veiled_audio_volume';
const MUTED_KEY = 'veiled_audio_muted';
const SPEED_KEY = 'veiled_audio_speed';

const VOLUME_DEFAULT = 0.75;
const SPEED_DEFAULT = 1.0;

export function getAudioVolume(): number {
  const stored = storageGet(VOLUME_KEY);
  if (stored === null) return VOLUME_DEFAULT;
  const val = Number(stored);
  return val >= 0 && val <= 1 ? val : VOLUME_DEFAULT;
}

export function setAudioVolume(v: number): void {
  storageSet(VOLUME_KEY, String(Math.max(0, Math.min(1, v))));
}

export function getAudioMuted(): boolean {
  return storageGet(MUTED_KEY) === 'true';
}

export function setAudioMuted(muted: boolean): void {
  storageSet(MUTED_KEY, String(muted));
}

export function getAudioSpeed(): number {
  const stored = storageGet(SPEED_KEY);
  if (stored === null) return SPEED_DEFAULT;
  const val = Number(stored);
  return val >= 0.5 && val <= 2.0 ? val : SPEED_DEFAULT;
}

export function setAudioSpeed(speed: number): void {
  storageSet(SPEED_KEY, String(Math.max(0.5, Math.min(2.0, speed))));
}
