// File category definitions for the create listing modal.
// Single source of truth — add or remove categories here.
// The `enabled` flag gates each category behind an integration flag;
// only categories with `enabled: true` can be used to create listings.

export type FileCategory = 'text' | 'document' | 'audio' | 'image' | 'video' | 'other';

export interface SubCategory {
  id: string;
  label: string;
  children?: SubCategory[];
}

export interface CategoryConfig {
  id: FileCategory;
  label: string;
  description: string;
  enabled: boolean;
  acceptedExtensions: string[];
  subcategories?: SubCategory[];
}

export const FILE_CATEGORIES: CategoryConfig[] = [
  {
    id: 'text',
    label: 'Text',
    description: 'Plain text, messages, keys, code',
    enabled: true,
    acceptedExtensions: [],
    subcategories: [
      { id: 'message', label: 'Message' },
      { id: 'code', label: 'Code' },
      { id: 'key', label: 'Key' },
      { id: 'creative', label: 'Creative' },
      { id: 'data', label: 'Data' },
    ],
  },
  {
    id: 'document',
    label: 'Document',
    description: 'PDF, DOCX, spreadsheets',
    enabled: true,
    acceptedExtensions: ['.pdf', '.doc', '.docx', '.pptx', '.odt', '.xls', '.xlsx', '.csv', '.txt', '.rtf'],
    subcategories: [
      { id: 'ebook', label: 'eBook' },
      { id: 'report', label: 'Report' },
      { id: 'spreadsheet', label: 'Spreadsheet' },
      { id: 'presentation', label: 'Presentation' },
      { id: 'template', label: 'Template' },
      { id: 'resume', label: 'Resume' },
      { id: 'manual', label: 'Manual' },
      { id: 'academic', label: 'Academic' },
    ],
  },
  {
    id: 'audio',
    label: 'Audio',
    description: 'Music, podcasts, recordings',
    enabled: true,
    acceptedExtensions: ['.mp3', '.wav', '.flac', '.ogg', '.aac', '.m4a', '.opus'],
    subcategories: [
      { id: 'music', label: 'Music', children: [
        { id: 'rock', label: 'Rock' },
        { id: 'pop', label: 'Pop' },
        { id: 'hiphop', label: 'Hip-Hop' },
        { id: 'electronic', label: 'Electronic' },
        { id: 'jazz', label: 'Jazz' },
        { id: 'classical', label: 'Classical' },
        { id: 'country', label: 'Country' },
        { id: 'rnb', label: 'R&B' },
        { id: 'metal', label: 'Metal' },
        { id: 'folk', label: 'Folk' },
        { id: 'reggae', label: 'Reggae' },
        { id: 'blues', label: 'Blues' },
        { id: 'latin', label: 'Latin' },
        { id: 'indie', label: 'Indie' },
        { id: 'ambient', label: 'Ambient' },
      ]},
      { id: 'podcast', label: 'Podcast' },
      { id: 'audiobook', label: 'Audiobook' },
      { id: 'soundeffect', label: 'Sound Effect' },
      { id: 'sample', label: 'Sample' },
      { id: 'fieldrecording', label: 'Field Recording' },
      { id: 'voiceover', label: 'Voiceover' },
      { id: 'asmr', label: 'ASMR' },
    ],
  },
  {
    id: 'image',
    label: 'Image',
    description: 'Photos, artwork, graphics',
    enabled: true,
    acceptedExtensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'],
    subcategories: [
      { id: 'photo', label: 'Photo' },
      { id: 'artwork', label: 'Artwork' },
      { id: 'graphic', label: 'Graphic' },
      { id: 'screenshot', label: 'Screenshot' },
      { id: 'wallpaper', label: 'Wallpaper' },
      { id: 'meme', label: 'Meme' },
      { id: '3drender', label: '3D Render' },
      { id: 'pixel', label: 'Pixel Art' },
      { id: 'comic', label: 'Comic' },
      { id: 'texture', label: 'Texture' },
      { id: 'stock', label: 'Stock' },
    ],
  },
  {
    id: 'video',
    label: 'Video',
    description: 'Films, clips, screencasts',
    enabled: true,
    acceptedExtensions: ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'],
    subcategories: [
      { id: 'film', label: 'Film', children: [
        { id: 'action', label: 'Action' },
        { id: 'comedy', label: 'Comedy' },
        { id: 'drama', label: 'Drama' },
        { id: 'horror', label: 'Horror' },
        { id: 'scifi', label: 'Sci-Fi' },
        { id: 'thriller', label: 'Thriller' },
        { id: 'documentary', label: 'Documentary' },
        { id: 'romance', label: 'Romance' },
        { id: 'animation', label: 'Animation' },
        { id: 'fantasy', label: 'Fantasy' },
        { id: 'mystery', label: 'Mystery' },
        { id: 'western', label: 'Western' },
        { id: 'crime', label: 'Crime' },
        { id: 'adventure', label: 'Adventure' },
        { id: 'war', label: 'War' },
      ]},
      { id: 'clip', label: 'Clip' },
      { id: 'tutorial', label: 'Tutorial' },
      { id: 'animation', label: 'Animation' },
      { id: 'musicvideo', label: 'Music Video' },
      { id: 'vlog', label: 'Vlog' },
      { id: 'gameplay', label: 'Gameplay' },
      { id: 'screencast', label: 'Screencast' },
      { id: 'timelapse', label: 'Timelapse' },
      { id: 'drone', label: 'Drone' },
      { id: 'live', label: 'Live' },
    ],
  },
  {
    id: 'other',
    label: 'Other',
    description: 'Archives, binaries, any file',
    enabled: true,
    acceptedExtensions: [],
    subcategories: [
      { id: 'archive', label: 'Archive' },
      { id: 'binary', label: 'Binary' },
      { id: 'model', label: '3D Model' },
      { id: 'font', label: 'Font' },
      { id: 'dataset', label: 'Dataset' },
      { id: 'plugin', label: 'Plugin' },
      { id: 'firmware', label: 'Firmware' },
    ],
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

/** Extract the top-level category from a colon-delimited category path (e.g. "audio:music" → "audio"). */
export function getTopLevelCategory(categoryPath: string): string {
  return categoryPath.split(':')[0];
}

/** Build a colon-delimited category path from a top-level category and optional subcategory. */
export function buildCategoryPath(category: FileCategory, subcategory?: string): string {
  if (!subcategory) return category;
  return `${category}:${subcategory}`;
}

/** Get the display label for a full category path (e.g. "audio:music:rock" → "Audio > Music > Rock"). */
export function getCategoryPathLabel(categoryPath: string): string {
  const parts = categoryPath.split(':');
  const topLevel = getCategoryConfig(parts[0] as FileCategory);
  if (!topLevel) return categoryPath;
  if (parts.length === 1) return topLevel.label;

  const sub = topLevel.subcategories?.find((s) => s.id === parts[1]);
  const labels = [topLevel.label, sub?.label ?? parts[1]];

  if (parts.length >= 3 && sub?.children) {
    const child = sub.children.find((c) => c.id === parts[2]);
    labels.push(child?.label ?? parts[2]);
  }

  return labels.join(' > ');
}

/** Check if a listing's category path matches a filter (supports startsWith for hierarchy). */
export function categoryMatchesFilter(listingCategory: string, filterCategory: string): boolean {
  if (filterCategory === 'all') return true;
  if (listingCategory === filterCategory) return true;
  // Top-level filter matches all sub-categories (e.g. "audio" matches "audio:music")
  return listingCategory.startsWith(filterCategory + ':');
}

/** Get all subcategories for a given top-level category. */
export function getSubcategories(category: FileCategory): SubCategory[] {
  return getCategoryConfig(category)?.subcategories ?? [];
}

/** Find a subcategory by ID within a given top-level category. */
export function findSubcategory(category: FileCategory, subcategoryId: string): SubCategory | undefined {
  return getSubcategories(category).find((s) => s.id === subcategoryId);
}

/** Get all subcategories across all categories as flat array of {categoryId, subcategory} pairs. */
export function getAllSubcategories(): Array<{ categoryId: FileCategory; subcategory: SubCategory }> {
  const result: Array<{ categoryId: FileCategory; subcategory: SubCategory }> = [];
  for (const cat of FILE_CATEGORIES) {
    if (cat.subcategories) {
      for (const sub of cat.subcategories) {
        result.push({ categoryId: cat.id, subcategory: sub });
      }
    }
  }
  return result;
}
