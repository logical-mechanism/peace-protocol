const VOLUME_KEY = 'veiled_video_volume';
const MUTED_KEY = 'veiled_video_muted';
const SPEED_KEY = 'veiled_video_speed';

const VOLUME_DEFAULT = 1.0;
const SPEED_DEFAULT = 1.0;

export function getVideoVolume(): number {
  try {
    const stored = localStorage.getItem(VOLUME_KEY);
    if (stored === null) return VOLUME_DEFAULT;
    const val = Number(stored);
    return val >= 0 && val <= 1 ? val : VOLUME_DEFAULT;
  } catch {
    return VOLUME_DEFAULT;
  }
}

export function setVideoVolume(v: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(Math.max(0, Math.min(1, v))));
  } catch { /* best-effort */ }
}

export function getVideoMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setVideoMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTED_KEY, String(muted));
  } catch { /* best-effort */ }
}

export function getVideoSpeed(): number {
  try {
    const stored = localStorage.getItem(SPEED_KEY);
    if (stored === null) return SPEED_DEFAULT;
    const val = Number(stored);
    return val >= 0.25 && val <= 3.0 ? val : SPEED_DEFAULT;
  } catch {
    return SPEED_DEFAULT;
  }
}

export function setVideoSpeed(speed: number): void {
  try {
    localStorage.setItem(SPEED_KEY, String(Math.max(0.25, Math.min(3.0, speed))));
  } catch { /* best-effort */ }
}
