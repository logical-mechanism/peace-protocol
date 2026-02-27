import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  getNonce,
  verifySignature,
  generateApiKey,
  verifyApiKey,
  uploadFile,
  downloadFile,
  deleteFile,
  searchFiles,
  listFiles,
} from '../iagonApi';
import type { IagonFileInfo } from '../iagonApi';

beforeEach(() => {
  vi.clearAllMocks();
});

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

// ── Tests ───────────────────────────────────────────────────────────

describe('iagonApi', () => {
  describe('getNonce', () => {
    it('calls iagon_get_nonce with address', async () => {
      mockInvoke.mockResolvedValueOnce('nonce-uuid-123');
      const result = await getNonce('abcdef');
      expect(mockInvoke).toHaveBeenCalledWith('iagon_get_nonce', { address: 'abcdef' });
      expect(result).toBe('nonce-uuid-123');
    });
  });

  describe('verifySignature', () => {
    it('calls iagon_verify with address, signature, and key', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'user-1', session: 'jwt-token' });
      const result = await verifySignature('addr-hex', 'sig-hex', 'key-hex');
      expect(mockInvoke).toHaveBeenCalledWith('iagon_verify', {
        address: 'addr-hex',
        signature: 'sig-hex',
        key: 'key-hex',
      });
      expect(result).toEqual({ id: 'user-1', session: 'jwt-token' });
    });
  });

  describe('generateApiKey', () => {
    it('calls iagon_generate_api_key with session token and name', async () => {
      mockInvoke.mockResolvedValueOnce('api-key-abc');
      const result = await generateApiKey('jwt-token', 'veiled-desktop');
      expect(mockInvoke).toHaveBeenCalledWith('iagon_generate_api_key', {
        sessionToken: 'jwt-token',
        name: 'veiled-desktop',
      });
      expect(result).toBe('api-key-abc');
    });
  });

  describe('verifyApiKey', () => {
    it('returns true when key is valid', async () => {
      mockInvoke.mockResolvedValueOnce(true);
      const result = await verifyApiKey('valid-key');
      expect(mockInvoke).toHaveBeenCalledWith('iagon_verify_api_key', { apiKey: 'valid-key' });
      expect(result).toBe(true);
    });

    it('returns false when key is invalid', async () => {
      mockInvoke.mockResolvedValueOnce(false);
      const result = await verifyApiKey('invalid-key');
      expect(result).toBe(false);
    });

    it('returns false on invoke error', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Network error'));
      const result = await verifyApiKey('bad-key');
      expect(result).toBe(false);
    });
  });

  describe('uploadFile', () => {
    it('calls iagon_upload with apiKey, file data as number array, and filename', async () => {
      const fileInfo: IagonFileInfo = {
        _id: 'file-1',
        name: 'test.enc',
        path: '/test.enc',
        unique_id: 'uniq-1',
        file_size_byte_native: 100,
        file_size_byte_encrypted: 120,
      };
      mockInvoke.mockResolvedValueOnce(fileInfo);
      const data = new Uint8Array([1, 2, 3, 4]);
      const result = await uploadFile('api-key', data, 'test.enc');
      expect(mockInvoke).toHaveBeenCalledWith('iagon_upload', {
        apiKey: 'api-key',
        fileData: [1, 2, 3, 4],
        filename: 'test.enc',
      });
      expect(result).toEqual(fileInfo);
    });
  });

  describe('downloadFile', () => {
    it('calls iagon_download and converts number[] to Uint8Array', async () => {
      mockInvoke.mockResolvedValueOnce([10, 20, 30]);
      const result = await downloadFile('api-key', 'file-1');
      expect(mockInvoke).toHaveBeenCalledWith('iagon_download', {
        apiKey: 'api-key',
        fileId: 'file-1',
      });
      expect(result).toBeInstanceOf(Uint8Array);
      expect(Array.from(result)).toEqual([10, 20, 30]);
    });
  });

  describe('deleteFile', () => {
    it('calls iagon_delete_file', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await deleteFile('api-key', 'file-1');
      expect(mockInvoke).toHaveBeenCalledWith('iagon_delete_file', {
        apiKey: 'api-key',
        fileId: 'file-1',
      });
    });
  });

  describe('searchFiles', () => {
    it('calls iagon_search_files and extracts files array', async () => {
      const files: IagonFileInfo[] = [
        { _id: 'f1', name: 'a.enc', path: '/a.enc', unique_id: 'u1', file_size_byte_native: 10, file_size_byte_encrypted: 12 },
      ];
      mockInvoke.mockResolvedValueOnce({ files });
      const result = await searchFiles('api-key', 'a.enc');
      expect(mockInvoke).toHaveBeenCalledWith('iagon_search_files', {
        apiKey: 'api-key',
        query: 'a.enc',
      });
      expect(result).toEqual(files);
    });
  });

  describe('listFiles', () => {
    it('calls iagon_list_files and extracts files array', async () => {
      const files: IagonFileInfo[] = [];
      mockInvoke.mockResolvedValueOnce({ files });
      const result = await listFiles('api-key');
      expect(mockInvoke).toHaveBeenCalledWith('iagon_list_files', {
        apiKey: 'api-key',
      });
      expect(result).toEqual([]);
    });
  });
});
