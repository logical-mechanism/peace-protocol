import { describe, it, expect } from 'vitest';
import { truncateHex, truncateWithPreset } from './truncate';

describe('truncateHex', () => {
  it('returns empty string for empty input', () => {
    expect(truncateHex('', 8, 4)).toBe('');
  });

  it('returns original string if shorter than start + end + 3', () => {
    // 8 + 4 + 3 = 15 chars minimum to truncate
    expect(truncateHex('abcdef', 8, 4)).toBe('abcdef');
    expect(truncateHex('123456789012345', 8, 4)).toBe('123456789012345');
  });

  it('truncates strings longer than start + end + 3', () => {
    const input = '1234567890abcdef1234';
    expect(truncateHex(input, 8, 4)).toBe('12345678...1234');
  });

  it('handles exact boundary (length === start + end + 3)', () => {
    // 8 + 4 + 3 = 15 chars
    expect(truncateHex('123456789012345', 8, 4)).toBe('123456789012345');
  });

  it('truncates at start + end + 4 length', () => {
    // 16 chars with (8, 4) should truncate
    expect(truncateHex('1234567890123456', 8, 4)).toBe('12345678...3456');
  });

  it('works with different start/end values', () => {
    const input = 'abcdefghijklmnopqrstuvwxyz';
    expect(truncateHex(input, 12, 6)).toBe('abcdefghijkl...uvwxyz');
    expect(truncateHex(input, 10, 6)).toBe('abcdefghij...uvwxyz');
    expect(truncateHex(input, 12, 8)).toBe('abcdefghijkl...stuvwxyz');
  });
});

describe('truncateWithPreset', () => {
  const longToken = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
  const longAddress = 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp';

  it('token-card: 8 + 4', () => {
    expect(truncateWithPreset(longToken, 'token-card')).toBe('a1b2c3d4...a1b2');
  });

  it('token-modal: 12 + 6', () => {
    expect(truncateWithPreset(longToken, 'token-modal')).toBe('a1b2c3d4e5f6...f6a1b2');
  });

  it('token-detail: 12 + 8', () => {
    expect(truncateWithPreset(longToken, 'token-detail')).toBe('a1b2c3d4e5f6...e5f6a1b2');
  });

  it('address-card: 10 + 6', () => {
    expect(truncateWithPreset(longAddress, 'address-card')).toBe('addr_test1...2ytjqp');
  });

  it('address-modal: 12 + 8', () => {
    expect(truncateWithPreset(longAddress, 'address-modal')).toBe('addr_test1qz...wq2ytjqp');
  });

  it('seller: 8 + 4', () => {
    expect(truncateWithPreset(longAddress, 'seller')).toBe('addr_tes...tjqp');
  });

  it('seller-modal: 10 + 6', () => {
    expect(truncateWithPreset(longAddress, 'seller-modal')).toBe('addr_test1...2ytjqp');
  });

  it('tx-hash: 8 + 8', () => {
    expect(truncateWithPreset(longToken, 'tx-hash')).toBe('a1b2c3d4...e5f6a1b2');
  });

  it('returns short values unchanged', () => {
    expect(truncateWithPreset('abc', 'token-card')).toBe('abc');
  });
});
