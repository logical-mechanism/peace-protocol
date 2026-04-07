import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  listLibraryItems,
  readLibraryContent,
  deleteLibraryItem,
  readSubtitleFile,
  openWithSystem,
  exportLibraryContent,
  getLibraryContentUrl,
  getLibrarySubtitleUrl,
  decodeAudioWaveform,
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

  describe('getLibraryContentUrl', () => {
    it('returns localhost URL with media server port', async () => {
      mockInvoke
        .mockResolvedValueOnce('/data/media/content/video/token1/file.mp4') // get_library_content_path
        .mockResolvedValueOnce(9876); // get_media_server_port
      const url = await getLibraryContentUrl('token1', 'video');
      expect(url).toBe('http://127.0.0.1:9876/data/media/content/video/token1/file.mp4');
    });

    it('caches media server port on subsequent calls', async () => {
      // Port was cached from previous test, so only content path invoke needed
      mockInvoke.mockResolvedValueOnce('/data/media/content/audio/token2/song.mp3');
      const url = await getLibraryContentUrl('token2', 'audio');
      expect(url).toBe('http://127.0.0.1:9876/data/media/content/audio/token2/song.mp3');
    });
  });

  describe('getLibrarySubtitleUrl', () => {
    it('returns URL when subtitle path exists', async () => {
      mockInvoke.mockResolvedValueOnce('/data/media/content/video/token1/subs.vtt');
      const url = await getLibrarySubtitleUrl('token1', 'video');
      expect(url).toBe('http://127.0.0.1:9876/data/media/content/video/token1/subs.vtt');
    });

    it('returns null when no subtitle path', async () => {
      mockInvoke.mockResolvedValueOnce(null);
      const url = await getLibrarySubtitleUrl('token1', 'video');
      expect(url).toBeNull();
    });
  });

  // ── Error path tests ─────────────────────────────────────────────

  describe('error handling', () => {
    it('listLibraryItems propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('wallet locked'));
      await expect(listLibraryItems()).rejects.toThrow('wallet locked');
    });

    it('readLibraryContent propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('file not found'));
      await expect(readLibraryContent('token1', 'text')).rejects.toThrow('file not found');
    });

    it('deleteLibraryItem propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('permission denied'));
      await expect(deleteLibraryItem('token1', 'document')).rejects.toThrow('permission denied');
    });

    it('readSubtitleFile propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('file not found'));
      await expect(readSubtitleFile('token1', 'video')).rejects.toThrow('file not found');
    });

    it('openWithSystem propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('no default application'));
      await expect(openWithSystem('token1', 'image')).rejects.toThrow('no default application');
    });

    it('exportLibraryContent propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('disk full'));
      await expect(exportLibraryContent('token1', 'document', 'f.pdf')).rejects.toThrow('disk full');
    });
  });

  describe('decodeAudioWaveform', () => {
    it('calls decode_audio_waveform and returns waveform result', async () => {
      const waveformResult = {
        waveform: Array(480).fill(0.5),
        sampleRate: 44100,
        durationSecs: 120,
        channels: 2,
      };
      mockInvoke.mockResolvedValueOnce(waveformResult);
      const result = await decodeAudioWaveform('token1', 'audio');
      expect(mockInvoke).toHaveBeenCalledWith('decode_audio_waveform', {
        tokenName: 'token1',
        category: 'audio',
      });
      expect(result).toEqual(waveformResult);
    });

    it('propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('unsupported format'));
      await expect(decodeAudioWaveform('token1', 'audio')).rejects.toThrow('unsupported format');
    });
  });
});
