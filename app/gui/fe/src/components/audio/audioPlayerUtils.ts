/** Linearly interpolate a waveform to a target length (e.g., 48 → 480 buckets). */
export function upsampleWaveform(data: Float32Array, targetLength: number): Float32Array {
  if (data.length === 0 || targetLength <= 0) return new Float32Array(targetLength);
  if (data.length === targetLength) return data;

  const result = new Float32Array(targetLength);
  const ratio = (data.length - 1) / (targetLength - 1);

  for (let i = 0; i < targetLength; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, data.length - 1);
    const frac = srcIdx - lo;
    result[i] = data[lo] * (1 - frac) + data[hi] * frac;
  }
  return result;
}

/** Normalize waveform peaks to [0, 1]. Mutates and returns the input array. */
export function normalizeWaveform(waveform: Float32Array): Float32Array {
  let max = 0;
  for (let i = 0; i < waveform.length; i++) if (waveform[i] > max) max = waveform[i];
  if (max > 0) for (let i = 0; i < waveform.length; i++) waveform[i] /= max;
  return waveform;
}
