import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { exportTextFile } from '../fileExport';

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('exportTextFile', () => {
  it('calls invoke with correct command and params', async () => {
    mockInvoke.mockResolvedValueOnce('/home/user/export.txt');
    await exportTextFile('Hello world', 'export.txt');
    expect(mockInvoke).toHaveBeenCalledWith('export_text_file', {
      content: 'Hello world',
      suggestedFilename: 'export.txt',
    });
  });

  it('returns saved file path on success', async () => {
    mockInvoke.mockResolvedValueOnce('/home/user/export.txt');
    const result = await exportTextFile('content', 'file.txt');
    expect(result).toBe('/home/user/export.txt');
  });

  it('returns null when user cancels', async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const result = await exportTextFile('content', 'file.txt');
    expect(result).toBeNull();
  });

  it('propagates invoke rejection', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Permission denied'));
    await expect(exportTextFile('content', 'file.txt')).rejects.toThrow(
      'Permission denied',
    );
  });
});
