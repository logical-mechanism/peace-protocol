/**
 * Notification Sound Service
 *
 * Plays a short notification ping using a native <audio> element.
 * Sound is generated programmatically as a WAV to avoid bundling files.
 * WebKitGTK Web Audio API is broken, so we rely on <audio> + GStreamer.
 */

const ENABLED_KEY = 'veiled_notification_sound_enabled';
const VOLUME_KEY = 'veiled_notification_sound_volume';

const DEFAULT_ENABLED = true;
const DEFAULT_VOLUME = 0.5;

// --- Settings persistence ---

export function isSoundEnabled(): boolean {
  const stored = localStorage.getItem(ENABLED_KEY);
  return stored !== null ? stored === 'true' : DEFAULT_ENABLED;
}

export function setSoundEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLED_KEY, String(enabled));
}

export function getSoundVolume(): number {
  const stored = localStorage.getItem(VOLUME_KEY);
  if (stored !== null) {
    const v = Number(stored);
    return isNaN(v) ? DEFAULT_VOLUME : Math.max(0, Math.min(1, v));
  }
  return DEFAULT_VOLUME;
}

export function setSoundVolume(volume: number): void {
  localStorage.setItem(VOLUME_KEY, String(Math.max(0, Math.min(1, volume))));
}

// --- WAV generation ---

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/** Generate a short sine-wave WAV as Uint8Array. */
function generatePingWav(
  frequencyHz = 880,
  durationMs = 200,
  sampleRate = 44100,
): Uint8Array {
  const numSamples = Math.floor(sampleRate * durationMs / 1000);
  const dataSize = numSamples * 2; // 16-bit mono
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);         // chunk size
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);          // block align
  view.setUint16(34, 16, true);         // bits per sample

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM samples with fade-in/fade-out envelope
  const fadeInSamples = Math.floor(sampleRate * 0.01);  // 10ms fade-in
  const fadeOutSamples = Math.floor(sampleRate * 0.03); // 30ms fade-out
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const fadeIn = Math.min(1, i / fadeInSamples);
    const fadeOut = Math.min(1, (numSamples - i) / fadeOutSamples);
    const envelope = fadeIn * fadeOut;
    const sample = Math.sin(2 * Math.PI * frequencyHz * t) * envelope * 0.5;
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  }

  return new Uint8Array(buffer);
}

// --- Singleton audio element ---

let blobUrl: string | null = null;
let audioElement: HTMLAudioElement | null = null;

function getAudioElement(): HTMLAudioElement {
  if (!audioElement) {
    const wav = generatePingWav();
    const blob = new Blob([wav as BlobPart], { type: 'audio/wav' });
    blobUrl = URL.createObjectURL(blob);
    audioElement = new Audio(blobUrl);
  }
  return audioElement;
}

/** Play the notification sound if enabled. Fire-and-forget. */
export function playNotificationSound(): void {
  if (!isSoundEnabled()) return;
  try {
    const audio = getAudioElement();
    audio.volume = getSoundVolume();
    audio.currentTime = 0;
    audio.play().catch(() => {
      // Autoplay policy may block; silently ignore
    });
  } catch {
    // Best effort
  }
}

// For testing — reset the singleton
export function _resetAudioElement(): void {
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  }
  audioElement = null;
}
