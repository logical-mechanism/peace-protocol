import { invoke } from '@tauri-apps/api/core';

export interface ImageResult {
  base64: string;
  content_type: string;
}

export interface ImageCacheStatus {
  cached: string[];
  banned: string[];
}

export async function downloadImage(
  tokenName: string,
  url: string
): Promise<ImageResult> {
  return invoke<ImageResult>('download_image', { tokenName, url });
}

export async function getCachedImage(
  tokenName: string
): Promise<ImageResult | null> {
  return invoke<ImageResult | null>('get_cached_image', { tokenName });
}

export async function listCachedImages(): Promise<ImageCacheStatus> {
  return invoke<ImageCacheStatus>('list_cached_images');
}

export async function banImage(tokenName: string): Promise<void> {
  return invoke<void>('ban_image', { tokenName });
}

export async function unbanImage(tokenName: string): Promise<void> {
  return invoke<void>('unban_image', { tokenName });
}
