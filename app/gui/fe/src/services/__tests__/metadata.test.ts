import { describe, it, expect } from 'vitest';
import { splitMetadataString, buildEncryptionMetadata, buildBidMetadata } from '../metadata';

describe('splitMetadataString', () => {
  it('returns [""] for empty string', () => {
    expect(splitMetadataString('')).toEqual(['']);
  });

  it('returns single-element array for string <= 64 bytes', () => {
    const short = 'Hello world';
    expect(splitMetadataString(short)).toEqual([short]);
  });

  it('returns single-element array for exactly 64 ASCII bytes', () => {
    const exact = 'a'.repeat(64);
    const result = splitMetadataString(exact);
    expect(result).toEqual([exact]);
    expect(new TextEncoder().encode(result[0]).length).toBe(64);
  });

  it('splits 65-byte ASCII string into two chunks', () => {
    const str = 'a'.repeat(65);
    const result = splitMetadataString(str);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('a'.repeat(64));
    expect(result[1]).toBe('a');
  });

  it('splits 128-byte ASCII string into exactly 2 chunks', () => {
    const str = 'b'.repeat(128);
    const result = splitMetadataString(str);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(64);
    expect(result[1]).toHaveLength(64);
  });

  it('splits 500-char ASCII description into 8 chunks', () => {
    const str = 'x'.repeat(500);
    const result = splitMetadataString(str);
    expect(result).toHaveLength(8); // 7*64 + 52
    for (const chunk of result) {
      expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(64);
    }
    expect(result.join('')).toBe(str);
  });

  it('never splits in the middle of a 4-byte emoji', () => {
    // Each emoji is 4 bytes UTF-8. 16 emojis = 64 bytes exactly.
    const emoji16 = '\u{1F600}'.repeat(16);
    expect(new TextEncoder().encode(emoji16).length).toBe(64);
    expect(splitMetadataString(emoji16)).toEqual([emoji16]);

    // 17 emojis = 68 bytes, should split into [16 emojis, 1 emoji]
    const emoji17 = '\u{1F600}'.repeat(17);
    const result = splitMetadataString(emoji17);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('\u{1F600}'.repeat(16));
    expect(result[1]).toBe('\u{1F600}');
  });

  it('handles 2-byte UTF-8 characters correctly', () => {
    // '\u00E9' (e-acute) = 2 bytes. 32 of them = 64 bytes exactly.
    const exact32 = '\u00E9'.repeat(32);
    expect(new TextEncoder().encode(exact32).length).toBe(64);
    expect(splitMetadataString(exact32)).toEqual([exact32]);

    // 33 of them = 66 bytes, needs split
    const str = '\u00E9'.repeat(33);
    const result = splitMetadataString(str);
    expect(result).toHaveLength(2);
    expect(new TextEncoder().encode(result[0]).length).toBeLessThanOrEqual(64);
    expect(result.join('')).toBe(str);
  });

  it('handles 3-byte UTF-8 characters correctly', () => {
    // CJK character '\u4e16' = 3 bytes. 21*3 = 63, fits. 22*3 = 66, needs split.
    const str = '\u4e16'.repeat(22);
    const result = splitMetadataString(str);
    expect(result).toHaveLength(2);
    expect(new TextEncoder().encode(result[0]).length).toBeLessThanOrEqual(64);
    expect(result.join('')).toBe(str);
  });

  it('reconstructs original string when chunks are joined', () => {
    const str = 'A mixed string with unicode: cafe\u0301 and emojis \u{1F680}\u{1F30D} repeated many times. '.repeat(5);
    const result = splitMetadataString(str);
    expect(result.join('')).toBe(str);
    for (const chunk of result) {
      expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(64);
    }
  });

  it('respects custom maxBytes parameter', () => {
    const str = 'abcdefghij'; // 10 bytes
    const result = splitMetadataString(str, 3);
    expect(result).toEqual(['abc', 'def', 'ghi', 'j']);
  });

  it('handles single character string', () => {
    expect(splitMetadataString('a')).toEqual(['a']);
  });

  it('handles string of all spaces', () => {
    const str = ' '.repeat(100);
    const result = splitMetadataString(str);
    expect(result.join('')).toBe(str);
    for (const chunk of result) {
      expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(64);
    }
  });
});

describe('buildEncryptionMetadata', () => {
  it('builds metadata with short fields', () => {
    const result = buildEncryptionMetadata('Short desc', '10', 'on-chain', '', 'text');
    expect(result.msg).toEqual(['Short desc']);
    expect(result.p).toBe('10');
    expect(result.s).toBe('on-chain');
    expect(result.i).toEqual(['']);
    expect(result.c).toBe('text');
  });

  it('chunks long description into multiple msg entries', () => {
    const longDesc = 'a'.repeat(200);
    const result = buildEncryptionMetadata(longDesc, '5', 'on-chain', '', 'text');
    const msg = result.msg as string[];
    expect(msg.length).toBeGreaterThan(1);
    expect(msg.join('')).toBe(longDesc);
    for (const chunk of msg) {
      expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(64);
    }
  });

  it('chunks long image link', () => {
    const longUrl = 'https://example.com/' + 'x'.repeat(100);
    const result = buildEncryptionMetadata('desc', '5', 'on-chain', longUrl, 'text');
    const imgChunks = result.i as string[];
    expect(imgChunks.length).toBeGreaterThan(1);
    expect(imgChunks.join('')).toBe(longUrl);
  });

  it('defaults price to "0" when empty', () => {
    const result = buildEncryptionMetadata('desc', '', 'on-chain', '', 'text');
    expect(result.p).toBe('0');
  });

  it('all string values comply with 64-byte limit', () => {
    const longDesc = 'Test description with lots of content. '.repeat(15);
    const longUrl = 'https://example.com/very/long/path/' + 'segment/'.repeat(20);
    const result = buildEncryptionMetadata(longDesc, '999.99', 'on-chain', longUrl, 'document');

    const encoder = new TextEncoder();
    for (const chunk of result.msg as string[]) {
      expect(encoder.encode(chunk).length).toBeLessThanOrEqual(64);
    }
    expect(encoder.encode(result.p as string).length).toBeLessThanOrEqual(64);
    expect(encoder.encode(result.s as string).length).toBeLessThanOrEqual(64);
    for (const chunk of result.i as string[]) {
      expect(encoder.encode(chunk).length).toBeLessThanOrEqual(64);
    }
    expect(encoder.encode(result.c as string).length).toBeLessThanOrEqual(64);
  });
});

describe('buildBidMetadata', () => {
  it('builds bid metadata with future price', () => {
    const result = buildBidMetadata('10.5');
    expect(result.msg).toEqual(['10.5']);
  });

  it('defaults to empty string when no price', () => {
    const result = buildBidMetadata('');
    expect(result.msg).toEqual(['']);
  });
});
