import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  getNonce,
  verifySignature,
  generateApiKey,
  verifyApiKey,
  uploadFile,
  downloadFile,
  encryptAndUpload,
  downloadAndSave,
  deleteFile,
  searchFiles,
  listFiles,
  getStorageUsage,
} from '../iagonApi';
import type { IagonFileInfo, IagonEncryptUploadResult, IagonDownloadSaveResult } from '../iagonApi';

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

  describe('getStorageUsage', () => {
    it('aggregates total encrypted byte count and file count from listFiles', async () => {
      const files: IagonFileInfo[] = [
        { _id: 'f1', name: 'a.enc', path: '/a.enc', unique_id: 'u1', file_size_byte_native: 100, file_size_byte_encrypted: 120 },
        { _id: 'f2', name: 'b.enc', path: '/b.enc', unique_id: 'u2', file_size_byte_native: 500, file_size_byte_encrypted: 540 },
        { _id: 'f3', name: 'c.enc', path: '/c.enc', unique_id: 'u3', file_size_byte_native: 10, file_size_byte_encrypted: 20 },
      ];
      mockInvoke.mockResolvedValueOnce({ files });
      const result = await getStorageUsage('api-key');
      expect(mockInvoke).toHaveBeenCalledWith('iagon_list_files', { apiKey: 'api-key' });
      expect(result).toEqual({ totalBytes: 680, fileCount: 3 });
    });

    it('returns zeros when no files exist', async () => {
      mockInvoke.mockResolvedValueOnce({ files: [] });
      const result = await getStorageUsage('api-key');
      expect(result).toEqual({ totalBytes: 0, fileCount: 0 });
    });

    it('treats missing file_size_byte_encrypted as 0', async () => {
      const files = [
        { _id: 'f1', name: 'a.enc', path: '/a.enc', unique_id: 'u1', file_size_byte_native: 100 },
        { _id: 'f2', name: 'b.enc', path: '/b.enc', unique_id: 'u2', file_size_byte_native: 200, file_size_byte_encrypted: 220 },
      ] as IagonFileInfo[];
      mockInvoke.mockResolvedValueOnce({ files });
      const result = await getStorageUsage('api-key');
      expect(result).toEqual({ totalBytes: 220, fileCount: 2 });
    });

    it('propagates listFiles invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('network error'));
      await expect(getStorageUsage('api-key')).rejects.toThrow('network error');
    });
  });

  // ── File-based IPC tests (no byte arrays cross IPC) ──────────────

  describe('encryptAndUpload', () => {
    it('calls iagon_encrypt_and_upload with file path (no byte arrays)', async () => {
      const result: IagonEncryptUploadResult = {
        file_info: {
          _id: 'file-1',
          name: 'test.enc',
          path: '/test.enc',
          unique_id: 'uniq-1',
          file_size_byte_native: 100,
          file_size_byte_encrypted: 120,
        },
        key_hex: 'a'.repeat(64),
        nonce_hex: 'b'.repeat(24),
        digest_hex: 'c'.repeat(64),
      };
      mockInvoke.mockResolvedValueOnce(result);
      const res = await encryptAndUpload('api-key', '/path/to/file.pdf', 'draft-123.pdf.enc');
      expect(mockInvoke).toHaveBeenCalledWith('iagon_encrypt_and_upload', {
        apiKey: 'api-key',
        filePath: '/path/to/file.pdf',
        filename: 'draft-123.pdf.enc',
      });
      // Verify no byte arrays in the invoke call
      const callArgs = mockInvoke.mock.calls[0][1] as Record<string, unknown>;
      for (const value of Object.values(callArgs)) {
        expect(value).not.toBeInstanceOf(Uint8Array);
        expect(Array.isArray(value)).toBe(false);
      }
      expect(res.file_info._id).toBe('file-1');
      expect(res.key_hex).toBe('a'.repeat(64));
    });
  });

  describe('downloadAndSave', () => {
    it('calls iagon_download_and_save with string params only', async () => {
      const result: IagonDownloadSaveResult = {
        path: '/data/content/document/tok123/tok123.pdf',
        size: 12345,
      };
      mockInvoke.mockResolvedValueOnce(result);
      const res = await downloadAndSave(
        'api-key', 'file-1', 'aa'.repeat(32), 'bb'.repeat(12),
        'cc'.repeat(32), 'tok123', 'document', 'tok123.pdf'
      );
      expect(mockInvoke).toHaveBeenCalledWith('iagon_download_and_save', {
        apiKey: 'api-key',
        fileId: 'file-1',
        keyHex: 'aa'.repeat(32),
        nonceHex: 'bb'.repeat(12),
        digestHex: 'cc'.repeat(32),
        tokenName: 'tok123',
        category: 'document',
        fileName: 'tok123.pdf',
      });
      expect(res.path).toContain('tok123.pdf');
      expect(res.size).toBe(12345);
    });

    it('passes null digestHex when no digest provided', async () => {
      mockInvoke.mockResolvedValueOnce({ path: '/path', size: 100 });
      await downloadAndSave('key', 'fid', 'aa'.repeat(32), 'bb'.repeat(12), null, 'tok', 'audio', 'f.mp3');
      const callArgs = mockInvoke.mock.calls[0][1] as Record<string, unknown>;
      expect(callArgs.digestHex).toBeNull();
    });
  });

  // ── Error path tests ─────────────────────────────────────────────

  describe('error handling', () => {
    it('getNonce propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('network error'));
      await expect(getNonce('addr')).rejects.toThrow('network error');
    });

    it('verifySignature propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('invalid signature'));
      await expect(verifySignature('addr', 'sig', 'key')).rejects.toThrow('invalid signature');
    });

    it('generateApiKey propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('expired session'));
      await expect(generateApiKey('jwt', 'name')).rejects.toThrow('expired session');
    });

    it('uploadFile propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('quota exceeded'));
      await expect(uploadFile('key', new Uint8Array([1]), 'f.enc')).rejects.toThrow('quota exceeded');
    });

    it('downloadFile propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('file not found'));
      await expect(downloadFile('key', 'file-1')).rejects.toThrow('file not found');
    });

    it('deleteFile propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('permission denied'));
      await expect(deleteFile('key', 'file-1')).rejects.toThrow('permission denied');
    });

    it('searchFiles propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('timeout'));
      await expect(searchFiles('key', 'query')).rejects.toThrow('timeout');
    });

    it('listFiles propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('wallet locked'));
      await expect(listFiles('key')).rejects.toThrow('wallet locked');
    });

    it('encryptAndUpload propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('File not found'));
      await expect(encryptAndUpload('key', '/no/file', 'f.enc')).rejects.toThrow('File not found');
    });

    it('downloadAndSave propagates invoke rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('AES-GCM decryption failed'));
      await expect(
        downloadAndSave('key', 'fid', 'aa'.repeat(32), 'bb'.repeat(12), null, 'tok', 'audio', 'f.mp3')
      ).rejects.toThrow('AES-GCM decryption failed');
    });
  });
});
