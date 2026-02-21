import { invoke } from '@tauri-apps/api/core';

export interface LibraryItem {
  tokenName: string;
  category: string;
  description?: string;
  suggestedPrice?: number;
  storageLayer?: string;
  imageLink?: string;
  seller?: string;
  createdAt?: string;
  decryptedAt: string;
  contentMissing: boolean;
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
