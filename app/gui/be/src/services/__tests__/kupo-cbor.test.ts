/**
 * Tests for the CBOR decoder and utility functions.
 *
 * Covers: hexToBytes, decodePlutusData, decodeCborItem, decodeRawUint, slotToUnixTime.
 *
 * CBOR hex values are hand-crafted to match the RFC 8949 encoding.
 * Plutus Data uses tags 121-127 for constructors 0-6, and 1280+ for 7+.
 */

import {
  hexToBytes,
  decodePlutusData,
  decodeCborItem,
  decodeRawUint,
  slotToUnixTime,
} from '../cbor.js';

// ===========================================================================
// hexToBytes
// ===========================================================================

describe('hexToBytes', () => {
  it('converts valid even-length hex to correct Uint8Array', () => {
    const result = hexToBytes('deadbeef');
    expect(result).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('returns empty Uint8Array for empty string', () => {
    const result = hexToBytes('');
    expect(result).toEqual(new Uint8Array([]));
  });

  it('throws on odd-length hex string', () => {
    expect(() => hexToBytes('abc')).toThrow('odd-length');
  });

  it('throws on invalid hex characters', () => {
    expect(() => hexToBytes('zzzz')).toThrow('invalid hex chars');
  });
});

// ===========================================================================
// decodePlutusData — integration tests through hex
// ===========================================================================

describe('decodePlutusData', () => {
  // --- Unsigned integers ---

  it('decodes unsigned int 0 (CBOR 00)', () => {
    expect(decodePlutusData('00')).toEqual({ int: 0 });
  });

  it('decodes unsigned int 23 (CBOR 17)', () => {
    expect(decodePlutusData('17')).toEqual({ int: 23 });
  });

  it('decodes unsigned int 24 (CBOR 1818)', () => {
    expect(decodePlutusData('1818')).toEqual({ int: 24 });
  });

  it('decodes unsigned int 500 (CBOR 1901f4)', () => {
    expect(decodePlutusData('1901f4')).toEqual({ int: 500 });
  });

  // --- Negative integers ---

  it('decodes negative int -1 (CBOR 20)', () => {
    expect(decodePlutusData('20')).toEqual({ int: -1 });
  });

  it('decodes negative int -100 (CBOR 3863)', () => {
    expect(decodePlutusData('3863')).toEqual({ int: -100 });
  });

  // --- Byte strings ---

  it('decodes empty byte string (CBOR 40)', () => {
    expect(decodePlutusData('40')).toEqual({ bytes: '' });
  });

  it('decodes short byte string 0xdeadbeef (CBOR 44deadbeef)', () => {
    expect(decodePlutusData('44deadbeef')).toEqual({ bytes: 'deadbeef' });
  });

  it('decodes indefinite-length byte string with 2 chunks (CBOR 5f42aabb42ccddff)', () => {
    // 5f        = indefinite byte string start
    // 42 aabb   = definite chunk: 2 bytes = aabb
    // 42 ccdd   = definite chunk: 2 bytes = ccdd
    // ff        = break
    expect(decodePlutusData('5f42aabb42ccddff')).toEqual({ bytes: 'aabbccdd' });
  });

  // --- Arrays ---

  it('decodes empty array (CBOR 80)', () => {
    expect(decodePlutusData('80')).toEqual({ list: [] });
  });

  it('decodes fixed-length array [1, 2] (CBOR 820102)', () => {
    expect(decodePlutusData('820102')).toEqual({
      list: [{ int: 1 }, { int: 2 }],
    });
  });

  it('decodes indefinite-length array [1] (CBOR 9f01ff)', () => {
    expect(decodePlutusData('9f01ff')).toEqual({
      list: [{ int: 1 }],
    });
  });

  // --- Maps ---

  it('decodes empty map (CBOR a0)', () => {
    expect(decodePlutusData('a0')).toEqual({ map: [] });
  });

  it('decodes map {0: bytes "aa"} (CBOR a10041aa)', () => {
    expect(decodePlutusData('a10041aa')).toEqual({
      map: [{ k: { int: 0 }, v: { bytes: 'aa' } }],
    });
  });

  // --- Constructors (Plutus tags) ---

  it('decodes constructor 0 with empty fields (tag 121, CBOR d87980)', () => {
    expect(decodePlutusData('d87980')).toEqual({ constructor: 0, fields: [] });
  });

  it('decodes constructor 1 with [bytes "aa"] (tag 122, CBOR d87a8141aa)', () => {
    expect(decodePlutusData('d87a8141aa')).toEqual({
      constructor: 1,
      fields: [{ bytes: 'aa' }],
    });
  });

  it('decodes constructor 6 with empty fields (tag 127, CBOR d87f80)', () => {
    expect(decodePlutusData('d87f80')).toEqual({ constructor: 6, fields: [] });
  });

  it('decodes constructor 7 with empty fields (tag 1280=0x500, CBOR d9050080)', () => {
    // Tag 1280 → constructor 1280 - 1280 + 7 = 7
    expect(decodePlutusData('d9050080')).toEqual({ constructor: 7, fields: [] });
  });

  // --- Indefinite-length map ---

  it('decodes indefinite-length map {1: 2} (CBOR bf01 02 ff)', () => {
    // bf       = indefinite-length map start
    // 01       = key: unsigned int 1
    // 02       = value: unsigned int 2
    // ff       = break
    expect(decodePlutusData('bf0102ff')).toEqual({
      map: [{ k: { int: 1 }, v: { int: 2 } }],
    });
  });

  // --- Text string (major type 3) ---

  it('decodes text string "hello" (CBOR 6568656c6c6f)', () => {
    // 65           = text string, length 5
    // 68656c6c6f   = "hello" in UTF-8
    expect(decodePlutusData('6568656c6c6f')).toBe('hello');
  });

  // --- Tag 102 general constructor ---

  it('decodes tag 102 general constructor with index 7 and fields [bytes "aa"]', () => {
    // d8 66      = tag(102)
    // 82         = array of length 2
    // 07         = unsigned int 7 (constructor index)
    // 81 41 aa   = array of length 1 containing bytes "aa" (fields)
    expect(decodePlutusData('d86682078141aa')).toEqual({
      constructor: 7,
      fields: [{ bytes: 'aa' }],
    });
  });

  // --- Error: unsupported major type ---

  it('throws on unsupported major type 7 (simple/float, CBOR f5 = true)', () => {
    expect(() => decodePlutusData('f5')).toThrow('unsupported major type');
  });
});

// ===========================================================================
// slotToUnixTime
// ===========================================================================

describe('slotToUnixTime', () => {
  it('converts preprod slot 0 to 1654041600', () => {
    expect(slotToUnixTime(0, 'preprod')).toBe(1654041600);
  });

  it('converts preprod slot 1000 to 1654042600', () => {
    expect(slotToUnixTime(1000, 'preprod')).toBe(1654042600);
  });

  it('converts mainnet Shelley start slot 4492800 to 1596491091', () => {
    expect(slotToUnixTime(4492800, 'mainnet')).toBe(1596491091);
  });

  it('converts mainnet slot 4492800 + 1000 to 1596491091 + 1000', () => {
    expect(slotToUnixTime(4492800 + 1000, 'mainnet')).toBe(1596491091 + 1000);
  });
});

// ===========================================================================
// decodeRawUint
// ===========================================================================

describe('decodeRawUint', () => {
  it('returns inline value for additional 0', () => {
    const data = new Uint8Array([0xff]); // payload not read for inline
    const [value, offset] = decodeRawUint(0, data, 0);
    expect(value).toBe(0);
    expect(offset).toBe(0); // no bytes consumed
  });

  it('returns inline value for additional 23', () => {
    const data = new Uint8Array([0xff]);
    const [value, offset] = decodeRawUint(23, data, 0);
    expect(value).toBe(23);
    expect(offset).toBe(0);
  });

  it('reads next byte for additional 24', () => {
    const data = new Uint8Array([0x42]); // value = 66
    const [value, offset] = decodeRawUint(24, data, 0);
    expect(value).toBe(0x42);
    expect(offset).toBe(1);
  });

  it('reads 2 bytes big-endian for additional 25', () => {
    // 0x01f4 = 500
    const data = new Uint8Array([0x01, 0xf4]);
    const [value, offset] = decodeRawUint(25, data, 0);
    expect(value).toBe(500);
    expect(offset).toBe(2);
  });

  it('reads 4 bytes big-endian for additional 26', () => {
    // 0x000186a0 = 100000
    const data = new Uint8Array([0x00, 0x01, 0x86, 0xa0]);
    const [value, offset] = decodeRawUint(26, data, 0);
    expect(value).toBe(100000);
    expect(offset).toBe(4);
  });

  it('throws on unsupported additional info 28', () => {
    const data = new Uint8Array([]);
    expect(() => decodeRawUint(28, data, 0)).toThrow('unsupported additional info');
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe('edge cases', () => {
  it('throws on empty Uint8Array (unexpected end of data)', () => {
    const empty = new Uint8Array([]);
    expect(() => decodeCborItem(empty, 0)).toThrow('unexpected end of data');
  });
});
