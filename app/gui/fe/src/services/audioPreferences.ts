const VOLUME_KEY = 'veiled_audio_volume';
const MUTED_KEY = 'veiled_audio_muted';
const SPEED_KEY = 'veiled_audio_speed';

const VOLUME_DEFAULT = 0.75;
const SPEED_DEFAULT = 1.0;

export function getAudioVolume(): number {
  try {
    const stored = localStorage.getItem(VOLUME_KEY);
    if (stored === null) return VOLUME_DEFAULT;
    const val = Number(stored);
    return val >= 0 && val <= 1 ? val : VOLUME_DEFAULT;
  } catch {
    return VOLUME_DEFAULT;
  }
}

export function setAudioVolume(v: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(Math.max(0, Math.min(1, v))));
  } catch { /* best-effort */ }
}

export function getAudioMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAudioMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTED_KEY, String(muted));
  } catch { /* best-effort */ }
}

export function getAudioSpeed(): number {
  try {
    const stored = localStorage.getItem(SPEED_KEY);
    if (stored === null) return SPEED_DEFAULT;
    const val = Number(stored);
    return val >= 0.5 && val <= 2.0 ? val : SPEED_DEFAULT;
  } catch {
    return SPEED_DEFAULT;
  }
}

export function setAudioSpeed(speed: number): void {
  try {
    localStorage.setItem(SPEED_KEY, String(Math.max(0.5, Math.min(2.0, speed))));
  } catch { /* best-effort */ }
}
