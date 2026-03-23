export function getMimeType(ext: string): string {
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

export function formatTime(seconds: number, unknownPlaceholder = false): string {
  if (!isFinite(seconds) || seconds < 0) return unknownPlaceholder ? '--:--' : '00:00';
  if (seconds === 0 && unknownPlaceholder) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function getConversionHint(ext: string): string | null {
  const hints: Record<string, string> = {
    '.flac': 'Try converting to MP3: ffmpeg -i file.flac -q:a 2 output.mp3',
    '.aac': 'Try converting to MP3: ffmpeg -i file.aac -c:a libmp3lame output.mp3',
    '.opus': 'Try converting to OGG: ffmpeg -i file.opus -c:a libvorbis output.ogg',
    '.m4a': 'Try converting to MP3: ffmpeg -i file.m4a -c:a libmp3lame output.mp3',
    '.wav': 'WAV is usually supported. The file may be corrupted or use an uncommon codec.',
    '.ogg': 'Try converting to MP3: ffmpeg -i file.ogg -c:a libmp3lame output.mp3',
    '.mp3': 'MP3 is widely supported. The file may be corrupted or use an uncommon bitrate.',
  };
  return hints[ext.toLowerCase()] ?? null;
}

/** Waveform seek ratio from a mouse event relative to a container element. */
export function computeSeekRatio(clientX: number, rect: DOMRect): number {
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

/** Tooltip left position clamped to stay within container bounds. */
export function computeTooltipLeft(clientX: number, rect: DOMRect, tooltipHalfWidth: number): number {
  const rawLeft = clientX - rect.left;
  return Math.max(tooltipHalfWidth, Math.min(rect.width - tooltipHalfWidth, rawLeft));
}
