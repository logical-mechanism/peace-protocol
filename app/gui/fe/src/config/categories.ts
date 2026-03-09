// File category definitions for the create listing modal.
// Single source of truth — add or remove categories here.
// The `enabled` flag gates each category behind an integration flag;
// only categories with `enabled: true` can be used to create listings.

export type FileCategory = 'text' | 'document' | 'audio' | 'image' | 'video' | 'other';

export interface CategoryConfig {
  id: FileCategory;
  label: string;
  description: string;
  enabled: boolean;
  acceptedExtensions: string[];
}

export const FILE_CATEGORIES: CategoryConfig[] = [
  {
    id: 'text',
    label: 'Text',
    description: 'Plain text, messages, keys, code',
    enabled: true,
    acceptedExtensions: [],
  },
  {
    id: 'document',
    label: 'Document',
    description: 'PDF, DOCX, spreadsheets',
    enabled: true,
    acceptedExtensions: ['.pdf', '.doc', '.docx', '.pptx', '.odt', '.xls', '.xlsx', '.csv', '.txt', '.rtf'],
  },
  {
    id: 'audio',
    label: 'Audio',
    description: 'Music, podcasts, recordings',
    enabled: true,
    acceptedExtensions: ['.mp3', '.wav', '.flac', '.ogg', '.aac', '.m4a', '.opus'],
  },
  {
    id: 'image',
    label: 'Image',
    description: 'Photos, artwork, graphics',
    enabled: true,
    acceptedExtensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'],
  },
  {
    id: 'video',
    label: 'Video',
    description: 'Films, clips, screencasts',
    enabled: true,
    acceptedExtensions: ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'],
  },
  {
    id: 'other',
    label: 'Other',
    description: 'Archives, binaries, any file',
    enabled: true,
    acceptedExtensions: [],
  },
];

export function getCategoryConfig(id: FileCategory): CategoryConfig | undefined {
  return FILE_CATEGORIES.find((c) => c.id === id);
}

export function isCategoryEnabled(id: FileCategory): boolean {
  return getCategoryConfig(id)?.enabled ?? false;
}

/** Detect file category from a filename or bare extension (e.g. ".mp3" or "song.mp3"). */
export function detectCategoryFromExtension(filenameOrExt: string): FileCategory {
  const dot = filenameOrExt.lastIndexOf('.');
  const ext = dot >= 0 ? filenameOrExt.slice(dot).toLowerCase() : '';
  if (!ext) return 'other';

  for (const cat of FILE_CATEGORIES) {
    if (cat.id === 'text' || cat.id === 'other') continue;
    if (cat.acceptedExtensions.includes(ext)) return cat.id;
  }
  return 'other';
}
