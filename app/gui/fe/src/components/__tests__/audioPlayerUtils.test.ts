import { describe, it, expect } from 'vitest';
import { fftInPlace, normalizeWaveform, upsampleWaveform } from '../audio/audioPlayerUtils';

describe('upsampleWaveform', () => {
  it('returns identity when lengths match', () => {
    const data = new Float32Array([0.1, 0.5, 0.9]);
    const result = upsampleWaveform(data, 3);
    expect(result).toBe(data); // same reference
  });

  it('upsamples 3 → 5 via linear interpolation', () => {
    const data = new Float32Array([0.0, 1.0, 0.0]);
    const result = upsampleWaveform(data, 5);
    expect(result.length).toBe(5);
    expect(result[0]).toBeCloseTo(0.0);
    expect(result[1]).toBeCloseTo(0.5);
    expect(result[2]).toBeCloseTo(1.0);
    expect(result[3]).toBeCloseTo(0.5);
    expect(result[4]).toBeCloseTo(0.0);
  });

  it('upsamples 48 → 480', () => {
    const data = new Float32Array(48).fill(0.5);
    data[0] = 0.0;
    data[47] = 1.0;
    const result = upsampleWaveform(data, 480);
    expect(result.length).toBe(480);
    expect(result[0]).toBeCloseTo(0.0);
    expect(result[479]).toBeCloseTo(1.0);
    // Middle values should be ~0.5
    expect(result[240]).toBeCloseTo(0.5, 1);
  });

  it('handles empty input', () => {
    const result = upsampleWaveform(new Float32Array(0), 10);
    expect(result.length).toBe(10);
    expect(result.every(v => v === 0)).toBe(true);
  });

  it('handles single element', () => {
    const result = upsampleWaveform(new Float32Array([0.7]), 5);
    expect(result.length).toBe(5);
    // All values should be 0.7 (constant interpolation)
    for (let i = 0; i < 5; i++) {
      expect(result[i]).toBeCloseTo(0.7);
    }
  });

  it('handles target length of 0', () => {
    const result = upsampleWaveform(new Float32Array([1, 2, 3]), 0);
    expect(result.length).toBe(0);
  });
});

describe('normalizeWaveform', () => {
  it('normalizes peak to 1.0', () => {
    const data = new Float32Array([0.2, 0.5, 0.1]);
    const result = normalizeWaveform(data);
    expect(result[1]).toBeCloseTo(1.0);
    expect(result[0]).toBeCloseTo(0.4);
  });

  it('handles all-zero input', () => {
    const data = new Float32Array([0, 0, 0]);
    const result = normalizeWaveform(data);
    expect(result.every(v => v === 0)).toBe(true);
  });
});

describe('fftInPlace', () => {
  it('produces correct magnitude for pure sine wave', () => {
    const n = 64;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    // Pure sine at bin 4
    for (let i = 0; i < n; i++) {
      re[i] = Math.sin(2 * Math.PI * 4 * i / n);
    }
    fftInPlace(re, im);

    // Bin 4 should have the dominant magnitude
    const mag4 = Math.sqrt(re[4] * re[4] + im[4] * im[4]);
    const mag0 = Math.sqrt(re[0] * re[0] + im[0] * im[0]);
    expect(mag4).toBeGreaterThan(mag0 + 1);
  });
});
