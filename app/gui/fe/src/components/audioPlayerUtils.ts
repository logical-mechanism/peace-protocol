/** Minimal in-place radix-2 Cooley-Tukey FFT. n must be a power of 2. */
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len *= 2) {
    const half = len >> 1;
    const ang = -2 * Math.PI / len;
    const wR = Math.cos(ang), wI = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cR = 1, cI = 0;
      for (let j = 0; j < half; j++) {
        const k = i + j + half;
        const tR = cR * re[k] - cI * im[k];
        const tI = cR * im[k] + cI * re[k];
        re[k] = re[i + j] - tR;
        im[k] = im[i + j] - tI;
        re[i + j] += tR;
        im[i + j] += tI;
        const nR = cR * wR - cI * wI;
        cI = cR * wI + cI * wR;
        cR = nR;
      }
    }
  }
}

/** Normalize waveform peaks to [0, 1]. Mutates and returns the input array. */
export function normalizeWaveform(waveform: Float32Array): Float32Array {
  let max = 0;
  for (let i = 0; i < waveform.length; i++) if (waveform[i] > max) max = waveform[i];
  if (max > 0) for (let i = 0; i < waveform.length; i++) waveform[i] /= max;
  return waveform;
}
