import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  downloadImage,
  getCachedImage,
  listCachedImages,
  banImage,
  unbanImage,
  deleteCachedImage,
} from '../imageCache';
import type { ImageResult, ImageCacheStatus } from '../imageCache';

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('downloadImage', () => {
  it('calls invoke with correct command and params', async () => {
    const result: ImageResult = { base64: 'abc123', content_type: 'image/png' };
    mockInvoke.mockResolvedValueOnce(result);
    await downloadImage('token1', 'https://example.com/img.png');
    expect(mockInvoke).toHaveBeenCalledWith('download_image', {
      tokenName: 'token1',
      url: 'https://example.com/img.png',
    });
  });

  it('returns ImageResult on success', async () => {
    const result: ImageResult = { base64: 'abc123', content_type: 'image/jpeg' };
    mockInvoke.mockResolvedValueOnce(result);
    const data = await downloadImage('token1', 'https://example.com/img.jpg');
    expect(data).toEqual(result);
  });
});

describe('getCachedImage', () => {
  it('returns cached image data', async () => {
    const result: ImageResult = { base64: 'cached', content_type: 'image/png' };
    mockInvoke.mockResolvedValueOnce(result);
    const data = await getCachedImage('token1');
    expect(data).toEqual(result);
    expect(mockInvoke).toHaveBeenCalledWith('get_cached_image', { tokenName: 'token1' });
  });

  it('returns null when not cached', async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const data = await getCachedImage('missing');
    expect(data).toBeNull();
  });
});

describe('listCachedImages', () => {
  it('returns cache status', async () => {
    const status: ImageCacheStatus = {
      cached: ['token1', 'token2'],
      banned: ['token3'],
      total_bytes: 1024,
    };
    mockInvoke.mockResolvedValueOnce(status);
    const data = await listCachedImages();
    expect(data).toEqual(status);
    expect(mockInvoke).toHaveBeenCalledWith('list_cached_images');
  });
});

describe('banImage', () => {
  it('calls invoke with correct command', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await banImage('token1');
    expect(mockInvoke).toHaveBeenCalledWith('ban_image', { tokenName: 'token1' });
  });
});

describe('unbanImage', () => {
  it('calls invoke with correct command', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await unbanImage('token1');
    expect(mockInvoke).toHaveBeenCalledWith('unban_image', { tokenName: 'token1' });
  });
});

describe('deleteCachedImage', () => {
  it('calls invoke with correct command', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await deleteCachedImage('token1');
    expect(mockInvoke).toHaveBeenCalledWith('delete_cached_image', { tokenName: 'token1' });
  });

  it('propagates invoke rejection', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('File not found'));
    await expect(deleteCachedImage('missing')).rejects.toThrow('File not found');
  });
});
