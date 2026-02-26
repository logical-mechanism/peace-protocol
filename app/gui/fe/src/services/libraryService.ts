import { invoke } from '@tauri-apps/api/core';

export interface LibraryItem {
  tokenName: string;
  category: string;
  description?: string;
  suggestedPrice?: number;
  storageLayer?: string;
  imageLink?: string;
  fileExtension?: string;
  seller?: string;
  createdAt?: string;
  decryptedAt: string;
  contentMissing: boolean;
  fileSize?: number;
}

export async function listLibraryItems(): Promise<LibraryItem[]> {
  return invoke<LibraryItem[]>('list_library_items');
}

export async function readLibraryContent(
  tokenName: string,
  category: string
): Promise<Uint8Array> {
  const data = await invoke<number[]>('read_library_content', { tokenName, category });
  return new Uint8Array(data);
}

export async function deleteLibraryItem(
  tokenName: string,
  category: string
): Promise<void> {
  return invoke<void>('delete_library_item', { tokenName, category });
}

export async function readSubtitleFile(
  tokenName: string,
  category: string
): Promise<Uint8Array | null> {
  const data = await invoke<number[] | null>('read_subtitle_file', { tokenName, category });
  return data ? new Uint8Array(data) : null;
}

export async function openWithSystem(
  tokenName: string,
  category: string
): Promise<void> {
  return invoke<void>('open_with_system', { tokenName, category });
}

export async function exportLibraryContent(
  tokenName: string,
  category: string,
  suggestedFilename: string,
): Promise<string | null> {
  return invoke<string | null>('export_library_content', {
    tokenName, category, suggestedFilename,
  });
}
