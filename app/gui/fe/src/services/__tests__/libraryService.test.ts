import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  listLibraryItems,
  readLibraryContent,
  deleteLibraryItem,
  readSubtitleFile,
  openWithSystem,
  exportLibraryContent,
} from '../libraryService';
import type { LibraryItem } from '../libraryService';

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────

describe('libraryService', () => {
  describe('listLibraryItems', () => {
    it('calls list_library_items and returns items', async () => {
      const items: LibraryItem[] = [
        {
          tokenName: 'token1',
          category: 'text',
          decryptedAt: '2025-01-01',
          contentMissing: false,
        },
      ];
      mockInvoke.mockResolvedValueOnce(items);
      const result = await listLibraryItems();
      expect(mockInvoke).toHaveBeenCalledWith('list_library_items');
      expect(result).toEqual(items);
    });
  });

  describe('readLibraryContent', () => {
    it('calls read_library_content and converts number[] to Uint8Array', async () => {
      mockInvoke.mockResolvedValueOnce([72, 101, 108, 108, 111]);
      const result = await readLibraryContent('token1', 'text');
      expect(mockInvoke).toHaveBeenCalledWith('read_library_content', {
        tokenName: 'token1',
        category: 'text',
      });
      expect(result).toBeInstanceOf(Uint8Array);
      expect(Array.from(result)).toEqual([72, 101, 108, 108, 111]);
    });
  });

  describe('deleteLibraryItem', () => {
    it('calls delete_library_item', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await deleteLibraryItem('token1', 'document');
      expect(mockInvoke).toHaveBeenCalledWith('delete_library_item', {
        tokenName: 'token1',
        category: 'document',
      });
    });
  });

  describe('readSubtitleFile', () => {
    it('converts number[] to Uint8Array when data exists', async () => {
      mockInvoke.mockResolvedValueOnce([87, 69, 66, 86, 84, 84]);
      const result = await readSubtitleFile('token1', 'video');
      expect(mockInvoke).toHaveBeenCalledWith('read_subtitle_file', {
        tokenName: 'token1',
        category: 'video',
      });
      expect(result).toBeInstanceOf(Uint8Array);
      expect(Array.from(result!)).toEqual([87, 69, 66, 86, 84, 84]);
    });

    it('returns null when no subtitle file exists', async () => {
      mockInvoke.mockResolvedValueOnce(null);
      const result = await readSubtitleFile('token1', 'video');
      expect(result).toBeNull();
    });
  });

  describe('openWithSystem', () => {
    it('calls open_with_system', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await openWithSystem('token1', 'image');
      expect(mockInvoke).toHaveBeenCalledWith('open_with_system', {
        tokenName: 'token1',
        category: 'image',
      });
    });
  });

  describe('exportLibraryContent', () => {
    it('returns saved file path', async () => {
      mockInvoke.mockResolvedValueOnce('/home/user/Downloads/file.pdf');
      const result = await exportLibraryContent('token1', 'document', 'file.pdf');
      expect(mockInvoke).toHaveBeenCalledWith('export_library_content', {
        tokenName: 'token1',
        category: 'document',
        suggestedFilename: 'file.pdf',
      });
      expect(result).toBe('/home/user/Downloads/file.pdf');
    });

    it('returns null when user cancels save dialog', async () => {
      mockInvoke.mockResolvedValueOnce(null);
      const result = await exportLibraryContent('token1', 'document', 'file.pdf');
      expect(result).toBeNull();
    });
  });
});
