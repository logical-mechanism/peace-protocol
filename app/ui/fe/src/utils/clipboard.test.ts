import { describe, it, expect, vi, beforeEach } from 'vitest';
import { copyToClipboard } from './clipboard';

describe('copyToClipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('copies text using clipboard API', async () => {
    const text = 'Hello, World!';
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
    });

    const result = await copyToClipboard(text);

    expect(result).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith(text);
  });

  it('returns false when clipboard API fails', async () => {
    const text = 'Hello, World!';
    const writeTextMock = vi.fn().mockRejectedValue(new Error('Not allowed'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
    });

    // Mock document.execCommand to also fail
    const execCommandMock = vi.fn().mockReturnValue(false);
    document.execCommand = execCommandMock;

    const result = await copyToClipboard(text);

    expect(result).toBe(false);
  });

  it('handles empty string', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
    });

    const result = await copyToClipboard('');

    expect(result).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith('');
  });

  it('handles special characters', async () => {
    const specialText = '🔐 Secret: <script>alert("xss")</script>';
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
    });

    const result = await copyToClipboard(specialText);

    expect(result).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith(specialText);
  });
});
