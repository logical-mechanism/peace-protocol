import { invoke } from '@tauri-apps/api/core';

/** Map category to default file extension. */
function getExtension(category: string): string {
  switch (category) {
    case 'text':
      return '.txt';
    case 'document':
      return '.pdf';
    case 'image':
      return '.png';
    case 'audio':
      return '.mp3';
    case 'video':
      return '.mp4';
    default:
      return '.bin';
  }
}

/**
 * Metadata saved alongside decrypted content for library display.
 * Mirrors the CIP-20 fields from EncryptionDisplay.
 */
export interface ContentMetadata {
  tokenName: string;
  description?: string;
  suggestedPrice?: number;
  storageLayer?: string;
  imageLink?: string;
  category: string;
  seller?: string;
  createdAt?: string;
  decryptedAt: string; // ISO timestamp of when content was decrypted
}

/**
 * Save decrypted content to the app data content directory.
 *
 * Files are stored at: media/content/{category}/{tokenName}/{tokenName}.{ext}
 *
 * @param tokenName - Encryption token name (used as both directory and file name)
 * @param category  - File category from CIP-20 metadata
 * @param data      - Raw decrypted bytes
 * @returns Absolute path of the saved file
 */
export async function saveDecryptedContent(
  tokenName: string,
  category: string,
  data: Uint8Array
): Promise<string> {
  const fileName = tokenName + getExtension(category);
  return invoke<string>('save_content', {
    tokenName,
    category,
    fileName,
    data: Array.from(data),
  });
}

/**
 * Save metadata alongside decrypted content for library display.
 *
 * Saved at: media/content/{category}/{tokenName}/{tokenName}.json
 *
 * @param metadata - Content metadata from the encryption listing
 * @returns Absolute path of the saved metadata file
 */
export async function saveContentMetadata(
  metadata: ContentMetadata
): Promise<string> {
  const json = JSON.stringify(metadata, null, 2);
  const data = new TextEncoder().encode(json);
  return invoke<string>('save_content', {
    tokenName: metadata.tokenName,
    category: metadata.category,
    fileName: metadata.tokenName + '.json',
    data: Array.from(data),
  });
}
