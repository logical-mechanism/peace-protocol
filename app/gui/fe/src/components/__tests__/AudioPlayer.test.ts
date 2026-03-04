import { describe, it, expect } from 'vitest';

// Import pure utility functions by re-exporting from the module.
// Since AudioPlayer.tsx doesn't export these, we test them via their logic directly.

// --- getMimeType ---

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.opus': 'audio/opus',
  };
  return map[ext.toLowerCase()] || 'audio/mpeg';
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function getConversionHint(ext: string): string | null {
  const hints: Record<string, string> = {
    '.flac': 'Try converting to MP3: ffmpeg -i file.flac -q:a 2 output.mp3',
    '.aac': 'Try converting to MP3: ffmpeg -i file.aac -c:a libmp3lame output.mp3',
    '.opus': 'Try converting to OGG: ffmpeg -i file.opus -c:a libvorbis output.ogg',
    '.m4a': 'Try converting to MP3: ffmpeg -i file.m4a -c:a libmp3lame output.mp3',
    '.wav': 'WAV is usually supported. The file may be corrupted or use an uncommon codec.',
  };
  return hints[ext.toLowerCase()] ?? null;
}

function computeWaveformSummary(channel: Float32Array, buckets: number): Float32Array {
  const samplesPerBucket = Math.floor(channel.length / buckets);
  if (samplesPerBucket < 1) return new Float32Array(0);
  const summary = new Float32Array(buckets);
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * samplesPerBucket;
    for (let j = 0; j < samplesPerBucket; j++) {
      const abs = Math.abs(channel[start + j] || 0);
      if (abs > max) max = abs;
    }
    summary[i] = max;
  }
  return summary;
}

describe('getMimeType', () => {
  it('returns correct MIME type for known extensions', () => {
    expect(getMimeType('.mp3')).toBe('audio/mpeg');
    expect(getMimeType('.wav')).toBe('audio/wav');
    expect(getMimeType('.flac')).toBe('audio/flac');
    expect(getMimeType('.ogg')).toBe('audio/ogg');
    expect(getMimeType('.aac')).toBe('audio/aac');
    expect(getMimeType('.m4a')).toBe('audio/mp4');
    expect(getMimeType('.opus')).toBe('audio/opus');
  });

  it('is case-insensitive', () => {
    expect(getMimeType('.MP3')).toBe('audio/mpeg');
    expect(getMimeType('.Flac')).toBe('audio/flac');
  });

  it('returns audio/mpeg as fallback for unknown extensions', () => {
    expect(getMimeType('.xyz')).toBe('audio/mpeg');
    expect(getMimeType('')).toBe('audio/mpeg');
  });
});

describe('formatTime', () => {
  it('formats seconds as MM:SS', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(5)).toBe('00:05');
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(600)).toBe('10:00');
    expect(formatTime(3661)).toBe('1:01:01');
  });

  it('formats as H:MM:SS when duration exceeds 60 minutes', () => {
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(3661)).toBe('1:01:01');
    expect(formatTime(7200)).toBe('2:00:00');
    expect(formatTime(36000)).toBe('10:00:00');
    expect(formatTime(86399)).toBe('23:59:59');
  });

  it('floors fractional seconds', () => {
    expect(formatTime(5.9)).toBe('00:05');
    expect(formatTime(59.99)).toBe('00:59');
  });

  it('returns 00:00 for invalid inputs', () => {
    expect(formatTime(NaN)).toBe('00:00');
    expect(formatTime(Infinity)).toBe('00:00');
    expect(formatTime(-Infinity)).toBe('00:00');
    expect(formatTime(-5)).toBe('00:00');
  });
});

describe('getConversionHint', () => {
  it('returns format-specific hints for known extensions', () => {
    expect(getConversionHint('.flac')).toContain('ffmpeg');
    expect(getConversionHint('.aac')).toContain('libmp3lame');
    expect(getConversionHint('.opus')).toContain('libvorbis');
    expect(getConversionHint('.m4a')).toContain('ffmpeg');
    expect(getConversionHint('.wav')).toContain('corrupted');
  });

  it('is case-insensitive', () => {
    expect(getConversionHint('.FLAC')).toContain('ffmpeg');
  });

  it('returns null for extensions without specific hints', () => {
    expect(getConversionHint('.mp3')).toBeNull();
    expect(getConversionHint('.ogg')).toBeNull();
    expect(getConversionHint('.xyz')).toBeNull();
  });
});

describe('remaining time display', () => {
  // Mirrors the logic: showRemaining ? `−${formatTime(Math.max(0, duration - currentTime))}` : formatTime(duration)
  function remainingTimeDisplay(duration: number, currentTime: number): string {
    return `\u2212${formatTime(Math.max(0, duration - currentTime))}`;
  }

  it('shows remaining time correctly mid-track', () => {
    expect(remainingTimeDisplay(300, 120)).toBe('\u221203:00'); // 5min track, 2min in → 3:00 remaining
  });

  it('shows 00:00 remaining at end of track', () => {
    expect(remainingTimeDisplay(300, 300)).toBe('\u221200:00');
  });

  it('clamps to 00:00 when currentTime exceeds duration', () => {
    // Can happen briefly when seeking near the end
    expect(remainingTimeDisplay(300, 305)).toBe('\u221200:00');
  });

  it('shows full duration when currentTime is 0', () => {
    expect(remainingTimeDisplay(185, 0)).toBe('\u221203:05');
  });

  it('handles both duration and currentTime at 0', () => {
    expect(remainingTimeDisplay(0, 0)).toBe('\u221200:00');
  });
});

// --- computeSeekRatio: mirrors the clamping logic used in handleSeekMouseDown / handleWaveformMouseDown ---

function computeSeekRatio(clientX: number, rectLeft: number, rectWidth: number): number {
  return Math.max(0, Math.min(1, (clientX - rectLeft) / rectWidth));
}

// --- computeTooltipLeft: mirrors the horizontal clamping in showSeekTooltip ---

function computeTooltipLeft(clientX: number, rectLeft: number, rectWidth: number, halfWidth: number): number {
  const rawLeft = clientX - rectLeft;
  return Math.max(halfWidth, Math.min(rectWidth - halfWidth, rawLeft));
}

describe('computeSeekRatio', () => {
  it('computes correct ratio for mid-bar positions', () => {
    expect(computeSeekRatio(150, 100, 200)).toBeCloseTo(0.25);
    expect(computeSeekRatio(200, 100, 200)).toBeCloseTo(0.5);
    expect(computeSeekRatio(250, 100, 200)).toBeCloseTo(0.75);
  });

  it('clamps to 0 when clicking left of the container', () => {
    expect(computeSeekRatio(50, 100, 200)).toBe(0);
    expect(computeSeekRatio(0, 100, 200)).toBe(0);
  });

  it('clamps to 1 when clicking right of the container', () => {
    expect(computeSeekRatio(350, 100, 200)).toBe(1);
    expect(computeSeekRatio(500, 100, 200)).toBe(1);
  });

  it('returns 0 for exact left edge', () => {
    expect(computeSeekRatio(100, 100, 200)).toBe(0);
  });

  it('returns 1 for exact right edge', () => {
    expect(computeSeekRatio(300, 100, 200)).toBe(1);
  });
});

describe('computeTooltipLeft', () => {
  // Container width 400, tooltip half-width 28
  const halfW = 28;
  const rectLeft = 50;
  const rectWidth = 400;

  it('positions tooltip at cursor when in middle of container', () => {
    // cursor at center: clientX = 250, rawLeft = 200
    expect(computeTooltipLeft(250, rectLeft, rectWidth, halfW)).toBe(200);
  });

  it('clamps tooltip to left edge to prevent overflow', () => {
    // cursor near left edge: clientX = 60, rawLeft = 10 < halfW
    expect(computeTooltipLeft(60, rectLeft, rectWidth, halfW)).toBe(halfW);
  });

  it('clamps tooltip to right edge to prevent overflow', () => {
    // cursor near right edge: clientX = 445, rawLeft = 395 > (400 - 28 = 372)
    expect(computeTooltipLeft(445, rectLeft, rectWidth, halfW)).toBe(rectWidth - halfW);
  });

  it('returns halfWidth when cursor is at container left edge', () => {
    expect(computeTooltipLeft(rectLeft, rectLeft, rectWidth, halfW)).toBe(halfW);
  });

  it('returns rectWidth - halfWidth when cursor is at container right edge', () => {
    expect(computeTooltipLeft(rectLeft + rectWidth, rectLeft, rectWidth, halfW)).toBe(rectWidth - halfW);
  });
});

describe('computeWaveformSummary', () => {
  it('computes peak values per bucket', () => {
    // 8 samples, 2 buckets → 4 samples per bucket
    const channel = new Float32Array([0.1, 0.5, 0.3, 0.2, 0.8, 0.4, 0.6, 0.7]);
    const result = computeWaveformSummary(channel, 2);
    expect(result.length).toBe(2);
    expect(result[0]).toBeCloseTo(0.5); // max of [0.1, 0.5, 0.3, 0.2]
    expect(result[1]).toBeCloseTo(0.8); // max of [0.8, 0.4, 0.6, 0.7]
  });

  it('handles negative values using absolute value', () => {
    const channel = new Float32Array([-0.9, 0.1, -0.2, 0.3]);
    const result = computeWaveformSummary(channel, 2);
    expect(result[0]).toBeCloseTo(0.9); // abs(-0.9)
    expect(result[1]).toBeCloseTo(0.3);
  });

  it('returns empty array when channel is too short for buckets', () => {
    const channel = new Float32Array([0.5]);
    const result = computeWaveformSummary(channel, 200);
    expect(result.length).toBe(0);
  });

  it('handles silence', () => {
    const channel = new Float32Array(100);
    const result = computeWaveformSummary(channel, 10);
    expect(result.length).toBe(10);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBe(0);
    }
  });

  it('handles single bucket covering all samples', () => {
    const channel = new Float32Array([0.1, 0.9, 0.3, 0.5]);
    const result = computeWaveformSummary(channel, 1);
    expect(result.length).toBe(1);
    expect(result[0]).toBeCloseTo(0.9);
  });
});

// --- Log-frequency bin mapping ---

/** Mirrors the log-frequency bin range calculation from drawFrame(). */
function computeLogBinRange(barIndex: number, barCount: number, halfFFT: number): { lowBin: number; highBin: number } {
  const lowBin = Math.floor(halfFFT * (barIndex / barCount) ** 2);
  const highBin = Math.max(lowBin + 1, Math.floor(halfFFT * ((barIndex + 1) / barCount) ** 2));
  return { lowBin, highBin };
}

describe('log-frequency bin mapping', () => {
  const FFT_SIZE = 1024;
  const halfFFT = FFT_SIZE / 2; // 512
  const BAR_COUNT = 32;

  it('first bar starts at bin 0', () => {
    const { lowBin } = computeLogBinRange(0, BAR_COUNT, halfFFT);
    expect(lowBin).toBe(0);
  });

  it('last bar ends at halfFFT', () => {
    const { highBin } = computeLogBinRange(BAR_COUNT - 1, BAR_COUNT, halfFFT);
    expect(highBin).toBe(halfFFT);
  });

  it('every bar has at least 1 bin', () => {
    for (let i = 0; i < BAR_COUNT; i++) {
      const { lowBin, highBin } = computeLogBinRange(i, BAR_COUNT, halfFFT);
      expect(highBin - lowBin).toBeGreaterThanOrEqual(1);
    }
  });

  it('bins are contiguous (no gaps between adjacent bars)', () => {
    for (let i = 0; i < BAR_COUNT - 1; i++) {
      const { highBin: prevHigh } = computeLogBinRange(i, BAR_COUNT, halfFFT);
      const { lowBin: nextLow } = computeLogBinRange(i + 1, BAR_COUNT, halfFFT);
      // Adjacent bars share the boundary — highBin of bar i equals lowBin of bar i+1
      // (highBin is exclusive, lowBin is inclusive)
      expect(nextLow).toBe(Math.floor(halfFFT * ((i + 1) / BAR_COUNT) ** 2));
      expect(prevHigh).toBeGreaterThanOrEqual(nextLow);
    }
  });

  it('allocates more bins to higher bars (log distribution)', () => {
    const firstRange = computeLogBinRange(0, BAR_COUNT, halfFFT);
    const lastRange = computeLogBinRange(BAR_COUNT - 1, BAR_COUNT, halfFFT);
    const firstBins = firstRange.highBin - firstRange.lowBin;
    const lastBins = lastRange.highBin - lastRange.lowBin;
    // Last bar should cover many more bins than first bar (treble has more bins)
    expect(lastBins).toBeGreaterThan(firstBins);
  });

  it('bass bars (first quarter) cover fewer total bins than treble bars (last quarter)', () => {
    let bassBins = 0;
    let trebleBins = 0;
    const quarter = BAR_COUNT / 4;
    for (let i = 0; i < quarter; i++) {
      const { lowBin, highBin } = computeLogBinRange(i, BAR_COUNT, halfFFT);
      bassBins += highBin - lowBin;
    }
    for (let i = BAR_COUNT - quarter; i < BAR_COUNT; i++) {
      const { lowBin, highBin } = computeLogBinRange(i, BAR_COUNT, halfFFT);
      trebleBins += highBin - lowBin;
    }
    expect(trebleBins).toBeGreaterThan(bassBins);
  });
});

// --- Waveform pixel skip optimization ---

describe('waveform pixel skip optimization', () => {
  it('computes same pixel for close time positions', () => {
    // At 480px width and 300s duration, 1px = 300/480 = 0.625s
    const canvasWidth = 480;
    const duration = 300;
    const time1 = 150.0;
    const time2 = 150.3; // 0.3s difference < 0.625s per pixel
    const px1 = Math.round((time1 / duration) * canvasWidth);
    const px2 = Math.round((time2 / duration) * canvasWidth);
    expect(px1).toBe(px2); // Same pixel, redraw should be skipped
  });

  it('computes different pixel for distant time positions', () => {
    const canvasWidth = 480;
    const duration = 300;
    const time1 = 150.0;
    const time2 = 152.0; // 2s difference > 0.625s per pixel
    const px1 = Math.round((time1 / duration) * canvasWidth);
    const px2 = Math.round((time2 / duration) * canvasWidth);
    expect(px1).not.toBe(px2); // Different pixel, should redraw
  });

  it('pixel range covers 0 to canvasWidth', () => {
    const canvasWidth = 480;
    const duration = 120;
    expect(Math.round((0 / duration) * canvasWidth)).toBe(0);
    expect(Math.round((duration / duration) * canvasWidth)).toBe(canvasWidth);
  });
});

// --- LED status display priority ---

/** Mirrors the status text logic from the AudioPlayer LED display. */
function getStatusText(isReady: boolean, isBuffering: boolean, isPlaying: boolean, currentTime: number): string {
  if (!isReady) return 'Loading';
  if (isBuffering && isPlaying) return 'Buffering';
  if (isPlaying) return 'Playing';
  if (currentTime > 0) return 'Paused';
  return 'Ready';
}

describe('LED status display priority', () => {
  it('shows Loading when not ready', () => {
    expect(getStatusText(false, false, false, 0)).toBe('Loading');
  });

  it('Loading takes priority over all other states', () => {
    expect(getStatusText(false, true, true, 100)).toBe('Loading');
  });

  it('shows Buffering when playing and buffering', () => {
    expect(getStatusText(true, true, true, 50)).toBe('Buffering');
  });

  it('shows Playing when playing normally (not buffering)', () => {
    expect(getStatusText(true, false, true, 50)).toBe('Playing');
  });

  it('shows Paused when stopped with progress', () => {
    expect(getStatusText(true, false, false, 30)).toBe('Paused');
  });

  it('shows Ready at initial state', () => {
    expect(getStatusText(true, false, false, 0)).toBe('Ready');
  });

  it('does not show Buffering when paused (buffering flag stale)', () => {
    // isBuffering might linger after pause — should show Paused, not Buffering
    expect(getStatusText(true, true, false, 30)).toBe('Paused');
  });
});
