import { describe, it, expect } from 'vitest';
import { slotToUnixTime, decodePlutusData, hexToBytes, decodeCborItem, decodeRawUint } from '../cbor.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a Uint8Array from numeric byte values. */
function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

/** Convert a Uint8Array to hex string (for building test CBOR hex). */
function toHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── slotToUnixTime ───────────────────────────────────────────────────

describe('slotToUnixTime', () => {
  it('preprod slot 0 → 1654041600 (Shelley start)', () => {
    expect(slotToUnixTime(0, 'preprod')).toBe(1654041600);
  });

  it('preprod slot 1000 → 1654042600', () => {
    expect(slotToUnixTime(1000, 'preprod')).toBe(1654042600);
  });

  it('mainnet slot 4492800 → 1596491091 (Shelley start)', () => {
    expect(slotToUnixTime(4492800, 'mainnet')).toBe(1596491091);
  });

  it('mainnet slot 5000000 → 1596491091 + 507200', () => {
    expect(slotToUnixTime(5000000, 'mainnet')).toBe(1596491091 + 507200);
  });

  it('mainnet slot before Shelley produces negative-offset result', () => {
    // slot 0 on mainnet: 1596491091 + (0 - 4492800) = 1591998291
    expect(slotToUnixTime(0, 'mainnet')).toBe(1596491091 - 4492800);
  });

  it('preprod large slot number', () => {
    const slot = 100_000_000;
    expect(slotToUnixTime(slot, 'preprod')).toBe(1654041600 + slot);
  });
});

// ── hexToBytes ───────────────────────────────────────────────────────

describe('hexToBytes', () => {
  it('converts valid hex to Uint8Array', () => {
    expect(hexToBytes('deadbeef')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('handles empty string', () => {
    expect(hexToBytes('')).toEqual(new Uint8Array([]));
  });

  it('single byte "ff" → [255]', () => {
    expect(hexToBytes('ff')).toEqual(new Uint8Array([255]));
  });

  it('single byte "00" → [0]', () => {
    expect(hexToBytes('00')).toEqual(new Uint8Array([0]));
  });

  it('throws on odd-length hex string', () => {
    expect(() => hexToBytes('abc')).toThrow('odd-length hex string');
  });

  it('throws on invalid hex chars', () => {
    expect(() => hexToBytes('zzzz')).toThrow('invalid hex chars');
  });

  it('throws on partially invalid hex', () => {
    expect(() => hexToBytes('abgh')).toThrow('invalid hex chars');
  });
});

// ── decodeRawUint ────────────────────────────────────────────────────

describe('decodeRawUint', () => {
  it('inline value 0-23 returns value directly', () => {
    expect(decodeRawUint(0, bytes(), 0)).toEqual([0, 0]);
    expect(decodeRawUint(23, bytes(), 0)).toEqual([23, 0]);
    expect(decodeRawUint(10, bytes(), 0)).toEqual([10, 0]);
  });

  it('additional 24 reads 1-byte value', () => {
    expect(decodeRawUint(24, bytes(42), 0)).toEqual([42, 1]);
    expect(decodeRawUint(24, bytes(255), 0)).toEqual([255, 1]);
  });

  it('additional 25 reads 2-byte big-endian value', () => {
    // 0x0100 = 256
    expect(decodeRawUint(25, bytes(0x01, 0x00), 0)).toEqual([256, 2]);
    // 0xFFFF = 65535
    expect(decodeRawUint(25, bytes(0xff, 0xff), 0)).toEqual([65535, 2]);
  });

  it('additional 26 reads 4-byte big-endian value', () => {
    // 0x00010000 = 65536
    expect(decodeRawUint(26, bytes(0x00, 0x01, 0x00, 0x00), 0)).toEqual([65536, 4]);
    // 0x01000000 = 16777216
    expect(decodeRawUint(26, bytes(0x01, 0x00, 0x00, 0x00), 0)).toEqual([16777216, 4]);
  });

  it('additional 27 reads 8-byte big-endian value', () => {
    // Small 8-byte value: 0x0000000000000001 = 1
    expect(decodeRawUint(27, bytes(0, 0, 0, 0, 0, 0, 0, 1), 0)).toEqual([1, 8]);
    // 0x0000000000000100 = 256
    expect(decodeRawUint(27, bytes(0, 0, 0, 0, 0, 0, 1, 0), 0)).toEqual([256, 8]);
  });

  it('additional 28 throws unsupported', () => {
    expect(() => decodeRawUint(28, bytes(), 0)).toThrow('unsupported additional info 28');
  });

  it('additional 31 throws unsupported', () => {
    expect(() => decodeRawUint(31, bytes(), 0)).toThrow('unsupported additional info 31');
  });

  it('respects offset parameter', () => {
    // Skip first 2 bytes, read 1-byte value at offset 2
    expect(decodeRawUint(24, bytes(0x00, 0x00, 0x2a), 2)).toEqual([42, 3]);
  });
});

// ── decodeCborItem: unsigned integers (major type 0) ─────────────────

describe('decodeCborItem — unsigned integers', () => {
  it('small unsigned integer 0', () => {
    // CBOR: 0x00 → unsigned 0
    const [val, off] = decodeCborItem(bytes(0x00), 0);
    expect(val).toEqual({ int: 0 });
    expect(off).toBe(1);
  });

  it('small unsigned integer 23', () => {
    // CBOR: 0x17 → unsigned 23
    const [val] = decodeCborItem(bytes(0x17), 0);
    expect(val).toEqual({ int: 23 });
  });

  it('1-byte unsigned integer 42', () => {
    // CBOR: 0x18 0x2a → unsigned 42
    const [val, off] = decodeCborItem(bytes(0x18, 0x2a), 0);
    expect(val).toEqual({ int: 42 });
    expect(off).toBe(2);
  });

  it('2-byte unsigned integer 1000', () => {
    // CBOR: 0x19 0x03 0xe8 → unsigned 1000
    const [val, off] = decodeCborItem(bytes(0x19, 0x03, 0xe8), 0);
    expect(val).toEqual({ int: 1000 });
    expect(off).toBe(3);
  });

  it('4-byte unsigned integer 1000000', () => {
    // CBOR: 0x1a 0x00 0x0f 0x42 0x40 → unsigned 1000000
    const [val, off] = decodeCborItem(bytes(0x1a, 0x00, 0x0f, 0x42, 0x40), 0);
    expect(val).toEqual({ int: 1000000 });
    expect(off).toBe(5);
  });
});

// ── decodeCborItem: negative integers (major type 1) ─────────────────

describe('decodeCborItem — negative integers', () => {
  it('negative integer -1 (encoded as 0)', () => {
    // CBOR: 0x20 → negative 0 → -1 - 0 = -1
    const [val] = decodeCborItem(bytes(0x20), 0);
    expect(val).toEqual({ int: -1 });
  });

  it('negative integer -100', () => {
    // CBOR: 0x38 0x63 → negative 99 → -1 - 99 = -100
    const [val] = decodeCborItem(bytes(0x38, 0x63), 0);
    expect(val).toEqual({ int: -100 });
  });

  it('negative integer -24', () => {
    // CBOR: 0x37 → negative 23 → -1 - 23 = -24
    const [val] = decodeCborItem(bytes(0x37), 0);
    expect(val).toEqual({ int: -24 });
  });
});

// ── decodeCborItem: byte strings (major type 2) ─────────────────────

describe('decodeCborItem — byte strings', () => {
  it('empty byte string', () => {
    // CBOR: 0x40 → bstr of length 0
    const [val, off] = decodeCborItem(bytes(0x40), 0);
    expect(val).toEqual({ bytes: '' });
    expect(off).toBe(1);
  });

  it('short byte string', () => {
    // CBOR: 0x43 0xde 0xad 0xff → bstr of length 3
    const [val, off] = decodeCborItem(bytes(0x43, 0xde, 0xad, 0xff), 0);
    expect(val).toEqual({ bytes: 'deadff' });
    expect(off).toBe(4);
  });

  it('definite-length byte string with 1-byte length', () => {
    // 0x58 0x02 0xab 0xcd → bstr len=2, "abcd"
    const [val, off] = decodeCborItem(bytes(0x58, 0x02, 0xab, 0xcd), 0);
    expect(val).toEqual({ bytes: 'abcd' });
    expect(off).toBe(4);
  });

  it('indefinite-length byte string (two chunks)', () => {
    // 0x5f          → indefinite bstr
    //   0x42 0xaa 0xbb   → chunk: 2 bytes [aa, bb]
    //   0x42 0xcc 0xdd   → chunk: 2 bytes [cc, dd]
    //   0xff         → break
    const cbor = bytes(0x5f, 0x42, 0xaa, 0xbb, 0x42, 0xcc, 0xdd, 0xff);
    const [val, off] = decodeCborItem(cbor, 0);
    expect(val).toEqual({ bytes: 'aabbccdd' });
    expect(off).toBe(8);
  });

  it('indefinite-length byte string (G2 point simulation: 3 chunks of 32 bytes)', () => {
    // Simulates a 96-byte G2 point split into 3 × 32-byte chunks
    const chunk = new Uint8Array(32).fill(0x42);
    const chunkHex = toHex(chunk);

    // Build CBOR: 0x5f [0x58 0x20 ...32 bytes] × 3 0xff
    const parts: number[] = [0x5f];
    for (let i = 0; i < 3; i++) {
      parts.push(0x58, 0x20, ...chunk);
    }
    parts.push(0xff);

    const cbor = new Uint8Array(parts);
    const [val] = decodeCborItem(cbor, 0);
    expect(val).toEqual({ bytes: chunkHex + chunkHex + chunkHex });
    expect((val as { bytes: string }).bytes.length).toBe(192); // 96 bytes = 192 hex chars
  });
});

// ── decodeCborItem: text strings (major type 3) ─────────────────────

describe('decodeCborItem — text strings', () => {
  it('empty text string', () => {
    // CBOR: 0x60 → tstr of length 0
    const [val, off] = decodeCborItem(bytes(0x60), 0);
    expect(val).toBe('');
    expect(off).toBe(1);
  });

  it('short text string "abc"', () => {
    // CBOR: 0x63 0x61 0x62 0x63 → tstr len=3 "abc"
    const [val] = decodeCborItem(bytes(0x63, 0x61, 0x62, 0x63), 0);
    expect(val).toBe('abc');
  });

  it('text string with 1-byte length', () => {
    // CBOR: 0x78 0x05 "hello" (0x68 0x65 0x6c 0x6c 0x6f)
    const [val] = decodeCborItem(bytes(0x78, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f), 0);
    expect(val).toBe('hello');
  });
});

// ── decodeCborItem: arrays (major type 4) ────────────────────────────

describe('decodeCborItem — arrays', () => {
  it('empty array', () => {
    // CBOR: 0x80 → array of length 0
    const [val, off] = decodeCborItem(bytes(0x80), 0);
    expect(val).toEqual({ list: [] });
    expect(off).toBe(1);
  });

  it('array of two unsigned integers [1, 2]', () => {
    // CBOR: 0x82 0x01 0x02 → array(2) [1, 2]
    const [val, off] = decodeCborItem(bytes(0x82, 0x01, 0x02), 0);
    expect(val).toEqual({ list: [{ int: 1 }, { int: 2 }] });
    expect(off).toBe(3);
  });

  it('nested array [[1]]', () => {
    // CBOR: 0x81 0x81 0x01 → array(1) [array(1) [1]]
    const [val] = decodeCborItem(bytes(0x81, 0x81, 0x01), 0);
    expect(val).toEqual({ list: [{ list: [{ int: 1 }] }] });
  });

  it('indefinite-length array', () => {
    // CBOR: 0x9f 0x01 0x02 0xff → indef-array [1, 2]
    const [val, off] = decodeCborItem(bytes(0x9f, 0x01, 0x02, 0xff), 0);
    expect(val).toEqual({ list: [{ int: 1 }, { int: 2 }] });
    expect(off).toBe(4);
  });

  it('indefinite-length empty array', () => {
    // CBOR: 0x9f 0xff → indef-array []
    const [val, off] = decodeCborItem(bytes(0x9f, 0xff), 0);
    expect(val).toEqual({ list: [] });
    expect(off).toBe(2);
  });
});

// ── decodeCborItem: maps (major type 5) ──────────────────────────────

describe('decodeCborItem — maps', () => {
  it('empty map', () => {
    // CBOR: 0xa0 → map of 0 pairs
    const [val, off] = decodeCborItem(bytes(0xa0), 0);
    expect(val).toEqual({ map: [] });
    expect(off).toBe(1);
  });

  it('map with one integer pair {1: 2}', () => {
    // CBOR: 0xa1 0x01 0x02 → map(1) {1: 2}
    const [val, off] = decodeCborItem(bytes(0xa1, 0x01, 0x02), 0);
    expect(val).toEqual({ map: [{ k: { int: 1 }, v: { int: 2 } }] });
    expect(off).toBe(3);
  });

  it('map with two pairs', () => {
    // CBOR: 0xa2 0x01 0x02 0x03 0x04 → map(2) {1:2, 3:4}
    const [val] = decodeCborItem(bytes(0xa2, 0x01, 0x02, 0x03, 0x04), 0);
    expect(val).toEqual({
      map: [
        { k: { int: 1 }, v: { int: 2 } },
        { k: { int: 3 }, v: { int: 4 } },
      ],
    });
  });

  it('indefinite-length map', () => {
    // CBOR: 0xbf 0x01 0x02 0xff → indef-map {1: 2}
    const [val, off] = decodeCborItem(bytes(0xbf, 0x01, 0x02, 0xff), 0);
    expect(val).toEqual({ map: [{ k: { int: 1 }, v: { int: 2 } }] });
    expect(off).toBe(4);
  });

  it('indefinite-length empty map', () => {
    // CBOR: 0xbf 0xff → indef-map {}
    const [val, off] = decodeCborItem(bytes(0xbf, 0xff), 0);
    expect(val).toEqual({ map: [] });
    expect(off).toBe(2);
  });
});

// ── decodeCborItem: tags / Plutus constructors (major type 6) ────────

describe('decodeCborItem — Plutus constructors', () => {
  it('tag 121 → constructor 0 with empty fields', () => {
    // CBOR: 0xd8 0x79 0x80 → tag(121) array(0)
    const [val] = decodeCborItem(bytes(0xd8, 0x79, 0x80), 0);
    expect(val).toEqual({ constructor: 0, fields: [] });
  });

  it('tag 121 → constructor 0 with integer field', () => {
    // CBOR: 0xd8 0x79 0x81 0x05 → tag(121) array(1) [5]
    const [val] = decodeCborItem(bytes(0xd8, 0x79, 0x81, 0x05), 0);
    expect(val).toEqual({ constructor: 0, fields: [{ int: 5 }] });
  });

  it('tag 122 → constructor 1', () => {
    // CBOR: 0xd8 0x7a 0x80 → tag(122) array(0)
    const [val] = decodeCborItem(bytes(0xd8, 0x7a, 0x80), 0);
    expect(val).toEqual({ constructor: 1, fields: [] });
  });

  it('tag 127 → constructor 6', () => {
    // CBOR: 0xd8 0x7f 0x80 → tag(127) array(0)
    const [val] = decodeCborItem(bytes(0xd8, 0x7f, 0x80), 0);
    expect(val).toEqual({ constructor: 6, fields: [] });
  });

  it('tag 1280 → constructor 7', () => {
    // CBOR: 0xd9 0x05 0x00 0x80 → tag(1280) array(0)
    const [val] = decodeCborItem(bytes(0xd9, 0x05, 0x00, 0x80), 0);
    expect(val).toEqual({ constructor: 7, fields: [] });
  });

  it('tag 1281 → constructor 8', () => {
    // CBOR: 0xd9 0x05 0x01 0x80 → tag(1281) array(0)
    const [val] = decodeCborItem(bytes(0xd9, 0x05, 0x01, 0x80), 0);
    expect(val).toEqual({ constructor: 8, fields: [] });
  });

  it('tag 102 → general constructor', () => {
    // CBOR: 0xd8 0x66 0x82 0x18 0x0a 0x81 0x03
    // → tag(102) array(2) [int(10), array(1) [int(3)]]
    // → { constructor: 10, fields: [{ int: 3 }] }
    const [val] = decodeCborItem(bytes(0xd8, 0x66, 0x82, 0x18, 0x0a, 0x81, 0x03), 0);
    expect(val).toEqual({ constructor: 10, fields: [{ int: 3 }] });
  });

  it('unknown tag passes through content', () => {
    // Tag 1 (standard date/time) — CBOR: 0xc1 0x00 → tag(1) unsigned(0)
    const [val] = decodeCborItem(bytes(0xc1, 0x00), 0);
    expect(val).toEqual({ int: 0 }); // passes through the content
  });
});

// ── decodePlutusData (integration) ───────────────────────────────────

describe('decodePlutusData', () => {
  it('decodes integer from hex', () => {
    // 0x05 = unsigned int 5
    expect(decodePlutusData('05')).toEqual({ int: 5 });
  });

  it('decodes byte string from hex', () => {
    // 0x43 0xab 0xcd 0xef = bstr(3) "abcdef"
    expect(decodePlutusData('43abcdef')).toEqual({ bytes: 'abcdef' });
  });

  it('decodes constructor 0 with fields', () => {
    // 0xd8 0x79 0x82 0x01 0x02 = tag(121) array(2) [1, 2]
    expect(decodePlutusData('d879820102')).toEqual({
      constructor: 0,
      fields: [{ int: 1 }, { int: 2 }],
    });
  });

  it('decodes nested structure', () => {
    // Constructor 0 containing an array of a byte string and an int
    // tag(121) array(2) [ bstr(1) [0xff], int(42) ]
    // 0xd8 0x79 0x82 0x41 0xff 0x18 0x2a
    expect(decodePlutusData('d87982 41ff 182a'.replace(/ /g, ''))).toEqual({
      constructor: 0,
      fields: [{ bytes: 'ff' }, { int: 42 }],
    });
  });
});

// ── Error cases ──────────────────────────────────────────────────────

describe('error handling', () => {
  it('throws on empty data', () => {
    expect(() => decodeCborItem(bytes(), 0)).toThrow('unexpected end of data');
  });

  it('throws when offset exceeds data length', () => {
    expect(() => decodeCborItem(bytes(0x00), 5)).toThrow('unexpected end of data');
  });

  it('throws on unsupported major type 7 (simple/float)', () => {
    // 0xf5 = major type 7, additional 21 (true)
    expect(() => decodeCborItem(bytes(0xf5), 0)).toThrow('unsupported major type 7');
  });

  it('decodePlutusData throws on odd-length hex', () => {
    expect(() => decodePlutusData('abc')).toThrow('odd-length hex string');
  });

  it('decodePlutusData throws on invalid hex chars', () => {
    expect(() => decodePlutusData('zzzz')).toThrow('invalid hex chars');
  });
});
