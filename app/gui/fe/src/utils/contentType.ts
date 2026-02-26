export function getContentType(category: string, fileExtension?: string): string {
  if (category === 'text' || !category) return 'text';

  const ext = fileExtension?.toLowerCase();
  if (ext) {
    if (['.mp3', '.wav', '.flac', '.ogg', '.aac', '.m4a', '.opus'].includes(ext)) return 'audio';
    if (['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'].includes(ext)) return 'video';
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) return 'image';
    if (ext === '.pdf') return 'pdf';
    if (ext === '.csv' || ext === '.txt') return 'text';
  }

  return category || 'other';
}
