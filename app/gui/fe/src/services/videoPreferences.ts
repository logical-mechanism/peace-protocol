import { storageGet, storageSet } from './storageUtils';

const VOLUME_KEY = 'veiled_video_volume';
const MUTED_KEY = 'veiled_video_muted';
const SPEED_KEY = 'veiled_video_speed';

const VOLUME_DEFAULT = 1.0;
const SPEED_DEFAULT = 1.0;

export function getVideoVolume(): number {
  const stored = storageGet(VOLUME_KEY);
  if (stored === null) return VOLUME_DEFAULT;
  const val = Number(stored);
  return val >= 0 && val <= 1 ? val : VOLUME_DEFAULT;
}

export function setVideoVolume(v: number): void {
  storageSet(VOLUME_KEY, String(Math.max(0, Math.min(1, v))));
}

export function getVideoMuted(): boolean {
  return storageGet(MUTED_KEY) === 'true';
}

export function setVideoMuted(muted: boolean): void {
  storageSet(MUTED_KEY, String(muted));
}

export function getVideoSpeed(): number {
  const stored = storageGet(SPEED_KEY);
  if (stored === null) return SPEED_DEFAULT;
  const val = Number(stored);
  return val >= 0.25 && val <= 3.0 ? val : SPEED_DEFAULT;
}

export function setVideoSpeed(speed: number): void {
  storageSet(SPEED_KEY, String(Math.max(0.25, Math.min(3.0, speed))));
}
