import { formatTime } from './useAudioPlayback';
export { formatTime };
export { getMimeType, getConversionHint } from './useAudioPlayback';

/** Waveform seek ratio from a mouse event relative to a container element. */
export function computeSeekRatio(clientX: number, rect: DOMRect): number {
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

/** Tooltip left position clamped to stay within container bounds. */
export function computeTooltipLeft(clientX: number, rect: DOMRect, tooltipHalfWidth: number): number {
  const rawLeft = clientX - rect.left;
  return Math.max(tooltipHalfWidth, Math.min(rect.width - tooltipHalfWidth, rawLeft));
}

/** Compute waveform summary stats for testing. */
export function computeWaveformSummary(waveform: Float32Array): { min: number; max: number; mean: number } {
  let min = Infinity, max = -Infinity, sum = 0;
  for (let i = 0; i < waveform.length; i++) {
    if (waveform[i] < min) min = waveform[i];
    if (waveform[i] > max) max = waveform[i];
    sum += waveform[i];
  }
  return { min, max, mean: sum / waveform.length };
}
