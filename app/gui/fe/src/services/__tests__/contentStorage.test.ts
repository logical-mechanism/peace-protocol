import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  saveDecryptedContent,
  saveContentMetadata,
  type ContentMetadata,
} from '../contentStorage';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('saveDecryptedContent', () => {
  it('uses explicit file extension when provided', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue('/path/to/file.docx');

    const data = new Uint8Array([1, 2, 3]);
    await saveDecryptedContent('token1', 'document', data, '.docx');

    expect(invoke).toHaveBeenCalledWith('save_content', {
      tokenName: 'token1',
      category: 'document',
      fileName: 'token1.docx',
      data: [1, 2, 3],
    });
  });

  it('falls back to category-default extension for text', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue('/path/to/file.txt');

    const data = new Uint8Array([65, 66]);
    await saveDecryptedContent('token2', 'text', data);

    expect(invoke).toHaveBeenCalledWith('save_content', {
      tokenName: 'token2',
      category: 'text',
      fileName: 'token2.txt',
      data: [65, 66],
    });
  });

  it('falls back to .pdf for document category', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue('/path');

    await saveDecryptedContent('t', 'document', new Uint8Array([]));

    expect(invoke).toHaveBeenCalledWith('save_content', expect.objectContaining({
      fileName: 't.pdf',
    }));
  });

  it('falls back to .png for image category', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue('/path');

    await saveDecryptedContent('t', 'image', new Uint8Array([]));

    expect(invoke).toHaveBeenCalledWith('save_content', expect.objectContaining({
      fileName: 't.png',
    }));
  });

  it('falls back to .mp3 for audio category', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue('/path');

    await saveDecryptedContent('t', 'audio', new Uint8Array([]));

    expect(invoke).toHaveBeenCalledWith('save_content', expect.objectContaining({
      fileName: 't.mp3',
    }));
  });

  it('falls back to .mp4 for video category', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue('/path');

    await saveDecryptedContent('t', 'video', new Uint8Array([]));

    expect(invoke).toHaveBeenCalledWith('save_content', expect.objectContaining({
      fileName: 't.mp4',
    }));
  });

  it('falls back to .bin for unknown category', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue('/path');

    await saveDecryptedContent('t', 'mystery', new Uint8Array([]));

    expect(invoke).toHaveBeenCalledWith('save_content', expect.objectContaining({
      fileName: 't.bin',
    }));
  });

  it('converts Uint8Array to plain array for JSON serialization', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue('/path');

    const data = new Uint8Array([0, 128, 255]);
    await saveDecryptedContent('t', 'text', data);

    const callArgs = (invoke as ReturnType<typeof vi.fn>).mock.calls[0][1] as { data: number[] };
    expect(Array.isArray(callArgs.data)).toBe(true);
    expect(callArgs.data).toEqual([0, 128, 255]);
  });

  it('returns the saved file path from invoke', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue('/data/media/content/text/t/t.txt');

    const result = await saveDecryptedContent('t', 'text', new Uint8Array([]));
    expect(result).toBe('/data/media/content/text/t/t.txt');
  });
});

describe('saveContentMetadata', () => {
  it('serializes metadata as JSON and saves via invoke', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue('/path/to/meta.json');

    const metadata: ContentMetadata = {
      tokenName: 'token1',
      category: 'document',
      description: 'A test document',
      suggestedPrice: 10,
      decryptedAt: '2025-06-01T12:00:00Z',
    };

    await saveContentMetadata(metadata);

    expect(invoke).toHaveBeenCalledWith('save_content', {
      tokenName: 'token1',
      category: 'document',
      fileName: 'token1.json',
      data: expect.any(Array),
    });

    // Verify the data is valid JSON of the metadata
    const callArgs = (invoke as ReturnType<typeof vi.fn>).mock.calls[0][1] as { data: number[] };
    const jsonStr = new TextDecoder().decode(new Uint8Array(callArgs.data));
    const parsed = JSON.parse(jsonStr);
    expect(parsed.tokenName).toBe('token1');
    expect(parsed.description).toBe('A test document');
    expect(parsed.suggestedPrice).toBe(10);
  });

  it('includes optional fields when present', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue('/path');

    const metadata: ContentMetadata = {
      tokenName: 'tk',
      category: 'audio',
      fileExtension: '.flac',
      seller: 'addr_test1...',
      createdAt: '2025-01-01T00:00:00Z',
      decryptedAt: '2025-06-01T12:00:00Z',
    };

    await saveContentMetadata(metadata);

    const callArgs = (invoke as ReturnType<typeof vi.fn>).mock.calls[0][1] as { data: number[] };
    const jsonStr = new TextDecoder().decode(new Uint8Array(callArgs.data));
    const parsed = JSON.parse(jsonStr);
    expect(parsed.fileExtension).toBe('.flac');
    expect(parsed.seller).toBe('addr_test1...');
  });
});
