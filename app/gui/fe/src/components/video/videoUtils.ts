export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00';
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
    '.mkv': 'Try converting with: ffmpeg -i file.mkv -c copy output.mp4',
    '.avi': 'Try converting with: ffmpeg -i file.avi -c copy output.mp4',
    '.webm': 'Try converting with: ffmpeg -i file.webm -c:v libx264 -c:a aac output.mp4',
    '.flv': 'Try converting with: ffmpeg -i file.flv -c copy output.mp4',
    '.wmv': 'Try converting with: ffmpeg -i file.wmv -c:v libx264 -c:a aac output.mp4',
    '.mov': 'Try converting with: ffmpeg -i file.mov -c copy output.mp4',
    '.ts': 'Try converting with: ffmpeg -i file.ts -c copy output.mp4',
    '.mp4': 'MP4 is widely supported. The file may be corrupted or use an uncommon codec.',
  };
  return hints[ext.toLowerCase()] ?? null;
}
