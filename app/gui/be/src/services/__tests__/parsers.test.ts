/**
 * Tests for Plutus JSON datum parsers.
 *
 * The parsers expect the Plutus JSON schema that Koios returns for inline datums:
 *   - { constructor: N, fields: [...] } for constructors
 *   - { bytes: "hex" }                  for byte strings
 *   - { int: N }                        for integers
 *   - { list: [...] }                   for lists
 *
 * Internal helpers (asConstr, asBytes, asInt, asList) are NOT exported,
 * so they are exercised indirectly through the public parser functions.
 */

import {
  parseEncryptionDatum,
  parseBidDatum,
  parseHalfEncryptionLevel,
  parseOptionalFullLevel,
} from '../parsers.js';

// ---------------------------------------------------------------------------
// Reusable hex constants matching on-chain sizes
// ---------------------------------------------------------------------------

const G1_HEX = 'aa'.repeat(48); // 96 hex chars  — compressed BLS12-381 G1
const G2_HEX = 'bb'.repeat(96); // 192 hex chars — compressed BLS12-381 G2
const VKH_HEX = 'cc'.repeat(28); // 56 hex chars  — verification key hash (28 bytes)
const TOKEN_HEX = 'dd'.repeat(32); // 64 hex chars  — token name (32 bytes)
const NONCE_HEX = 'ee'.repeat(12); // 24 hex chars  — ChaCha20 nonce (12 bytes)
const AAD_HEX = 'ff'.repeat(32); // 64 hex chars  — AAD (32 bytes)
const CT_HEX = '11'.repeat(64); // 128 hex chars — ciphertext (variable)

// ---------------------------------------------------------------------------
// Helpers to build Plutus JSON constructors
// ---------------------------------------------------------------------------

function mkRegister(gen = G1_HEX, pub = G1_HEX) {
  return { constructor: 0, fields: [{ bytes: gen }, { bytes: pub }] };
}

function mkHalfLevel(r1b = G1_HEX, r2_g1b = G1_HEX, r4b = G2_HEX) {
  return { constructor: 0, fields: [{ bytes: r1b }, { bytes: r2_g1b }, { bytes: r4b }] };
}

function mkFullLevel(r1b = G1_HEX, r2_g1b = G1_HEX, r2_g2b = G2_HEX, r4b = G2_HEX) {
  return {
    constructor: 0,
    fields: [{ bytes: r1b }, { bytes: r2_g1b }, { bytes: r2_g2b }, { bytes: r4b }],
  };
}

function mkCapsule(nonce = NONCE_HEX, aad = AAD_HEX, ct = CT_HEX) {
  return { constructor: 0, fields: [{ bytes: nonce }, { bytes: aad }, { bytes: ct }] };
}

function mkGrothProof() {
  const piA = 'a1'.repeat(48);
  const piB = 'b2'.repeat(96);
  const piC = 'c3'.repeat(48);
  const commitment = 'd4'.repeat(48);
  const commitmentPok = 'e5'.repeat(48);
  return {
    constructor: 0,
    fields: [
      { bytes: piA },
      { bytes: piB },
      { bytes: piC },
      { list: [{ bytes: commitment }] },
      { bytes: commitmentPok },
    ],
  };
}

/** Open status: constructor 0, no fields */
function mkStatusOpen() {
  return { constructor: 0, fields: [] };
}

/** Pending status: constructor 1, fields = [GrothProof, List<Int>, Int] */
function mkStatusPending(ttl = 1000) {
  return {
    constructor: 1,
    fields: [mkGrothProof(), { list: [{ int: 42 }, { int: 99 }] }, { int: ttl }],
  };
}

/** Option Some(x): constructor 0, fields = [x] */
function mkSome(inner: unknown) {
  return { constructor: 0, fields: [inner] };
}

/** Option None: constructor 1, fields = [] */
function mkNone() {
  return { constructor: 1, fields: [] };
}

/** Build a full EncryptionDatum Plutus JSON value */
function mkEncryptionDatum(
  overrides: {
    fullLevel?: unknown;
    status?: unknown;
  } = {},
) {
  const fullLevel = overrides.fullLevel ?? mkNone();
  const status = overrides.status ?? mkStatusOpen();

  return {
    constructor: 0,
    fields: [
      { bytes: VKH_HEX },       // 0: owner_vkh
      mkRegister(),              // 1: owner_g1
      { bytes: TOKEN_HEX },     // 2: token
      mkHalfLevel(),             // 3: half_level
      fullLevel,                 // 4: full_level (Option)
      mkCapsule(),               // 5: capsule
      status,                    // 6: status
    ],
  };
}

/** Build a full BidDatum Plutus JSON value */
function mkBidDatum() {
  const pointer = 'ab'.repeat(32);
  return {
    constructor: 0,
    fields: [
      { bytes: VKH_HEX },       // 0: owner_vkh
      mkRegister(),              // 1: owner_g1
      { bytes: pointer },        // 2: pointer
      { bytes: TOKEN_HEX },     // 3: token
    ],
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('parseEncryptionDatum', () => {
  it('parses all 7 fields with Open status', () => {
    const datum = mkEncryptionDatum({ status: mkStatusOpen(), fullLevel: mkNone() });
    const result = parseEncryptionDatum(datum);

    expect(result.owner_vkh).toBe(VKH_HEX);
    expect(result.owner_g1).toEqual({ generator: G1_HEX, public_value: G1_HEX });
    expect(result.token).toBe(TOKEN_HEX);
    expect(result.half_level).toEqual({
      r1b: G1_HEX,
      r2_g1b: G1_HEX,
      r4b: G2_HEX,
    });
    expect(result.full_level).toBeNull();
    expect(result.capsule).toEqual({
      nonce: NONCE_HEX,
      aad: AAD_HEX,
      ct: CT_HEX,
    });
    expect(result.status).toEqual({ type: 'Open' });
  });

  it('parses Pending status with GrothProof, groth_public, and ttl', () => {
    const datum = mkEncryptionDatum({ status: mkStatusPending(5000) });
    const result = parseEncryptionDatum(datum);

    expect(result.status.type).toBe('Pending');
    if (result.status.type === 'Pending') {
      expect(result.status.groth_proof.piA).toBe('a1'.repeat(48));
      expect(result.status.groth_proof.piB).toBe('b2'.repeat(96));
      expect(result.status.groth_proof.piC).toBe('c3'.repeat(48));
      expect(result.status.groth_proof.commitments).toEqual(['d4'.repeat(48)]);
      expect(result.status.groth_proof.commitmentPok).toBe('e5'.repeat(48));
      expect(result.status.groth_public).toEqual([42, 99]);
      expect(result.status.ttl).toBe(5000);
    }
  });

  it('parses full_level as None (constructor 1) → null', () => {
    const datum = mkEncryptionDatum({ fullLevel: mkNone() });
    const result = parseEncryptionDatum(datum);
    expect(result.full_level).toBeNull();
  });

  it('parses full_level as Some (constructor 0) → FullEncryptionLevel', () => {
    const r1b = 'f1'.repeat(48);
    const r2_g1b = 'f2'.repeat(48);
    const r2_g2b = 'f3'.repeat(96);
    const r4b = 'f4'.repeat(96);
    const datum = mkEncryptionDatum({ fullLevel: mkSome(mkFullLevel(r1b, r2_g1b, r2_g2b, r4b)) });
    const result = parseEncryptionDatum(datum);

    expect(result.full_level).toEqual({ r1b, r2_g1b, r2_g2b, r4b });
  });
});

describe('parseBidDatum', () => {
  it('parses all 4 fields correctly', () => {
    const datum = mkBidDatum();
    const result = parseBidDatum(datum);

    expect(result.owner_vkh).toBe(VKH_HEX);
    expect(result.owner_g1).toEqual({ generator: G1_HEX, public_value: G1_HEX });
    expect(result.pointer).toBe('ab'.repeat(32));
    expect(result.token).toBe(TOKEN_HEX);
  });
});

describe('parseHalfEncryptionLevel', () => {
  it('extracts r1b, r2_g1b, r4b from constructor fields', () => {
    const r1b = 'a0'.repeat(48);
    const r2_g1b = 'b0'.repeat(48);
    const r4b = 'c0'.repeat(96);
    const plutus = mkHalfLevel(r1b, r2_g1b, r4b);
    const result = parseHalfEncryptionLevel(plutus);

    expect(result).toEqual({ r1b, r2_g1b, r4b });
  });
});

describe('parseOptionalFullLevel', () => {
  it('returns null for None (constructor 1, empty fields)', () => {
    const result = parseOptionalFullLevel(mkNone());
    expect(result).toBeNull();
  });

  it('extracts inner FullEncryptionLevel for Some (constructor 0)', () => {
    const r1b = 'e1'.repeat(48);
    const r2_g1b = 'e2'.repeat(48);
    const r2_g2b = 'e3'.repeat(96);
    const r4b = 'e4'.repeat(96);
    const result = parseOptionalFullLevel(mkSome(mkFullLevel(r1b, r2_g1b, r2_g2b, r4b)));

    expect(result).toEqual({ r1b, r2_g1b, r2_g2b, r4b });
  });
});

describe('error handling', () => {
  it('throws when a bytes node is passed where a constructor is expected', () => {
    // parseEncryptionDatum calls asConstr on the top-level value
    expect(() => parseEncryptionDatum({ bytes: 'aabb' })).toThrow();
  });

  it('throws when an int node is found where bytes is expected', () => {
    // BidDatum field 0 (owner_vkh) expects bytes; passing int instead
    const badBid = {
      constructor: 0,
      fields: [
        { int: 5 },             // should be bytes
        mkRegister(),
        { bytes: 'ab'.repeat(32) },
        { bytes: TOKEN_HEX },
      ],
    };
    expect(() => parseBidDatum(badBid)).toThrow('Expected bytes');
  });

  it('throws when constructor has too few fields (3 instead of 7)', () => {
    const shortDatum = {
      constructor: 0,
      fields: [
        { bytes: VKH_HEX },
        mkRegister(),
        { bytes: TOKEN_HEX },
        // Missing: half_level, full_level, capsule, status
      ],
    };
    // Accessing fields[3] (half_level) on undefined triggers an error in asConstr
    expect(() => parseEncryptionDatum(shortDatum)).toThrow();
  });
});

// CIP-20 metadata parsing
import { parseCip20Fields } from '../encryptions.js';
import { parseBidCip20Fields } from '../bids.js';

describe('parseCip20Fields', () => {
  it('parses complete msg array correctly', () => {
    const result = parseCip20Fields(['A cool item', '10.5', 'on-chain', 'https://img.png', 'text']);
    expect(result.description).toBe('A cool item');
    expect(result.suggestedPrice).toBe(10.5);
    expect(result.storageLayer).toBe('on-chain');
    expect(result.imageLink).toBe('https://img.png');
    expect(result.category).toBe('text');
  });

  it('preserves zero price (not treated as falsy)', () => {
    const result = parseCip20Fields(['desc', '0', 'on-chain']);
    expect(result.suggestedPrice).toBe(0);
  });

  it('returns undefined for empty strings', () => {
    const result = parseCip20Fields(['', '', '']);
    expect(result.description).toBeUndefined();
    expect(result.storageLayer).toBeUndefined();
  });

  it('returns undefined for non-numeric price', () => {
    const result = parseCip20Fields(['desc', 'not-a-number', 'on-chain']);
    expect(result.suggestedPrice).toBeUndefined();
  });

  it('handles short array without crashing', () => {
    const result = parseCip20Fields(['desc']);
    expect(result.description).toBe('desc');
    expect(result.suggestedPrice).toBeUndefined();
    expect(result.storageLayer).toBeUndefined();
    expect(result.imageLink).toBeUndefined();
    expect(result.category).toBeUndefined();
  });
});

describe('parseCip20Fields — boundary', () => {
  it('throws on undefined input (guards against missing metadata)', () => {
    // parseCip20Fields destructures its argument; undefined is not iterable
    expect(() => parseCip20Fields(undefined as unknown as string[])).toThrow();
  });
});

describe('parseCip20Fields — new structured format', () => {
  it('detects new format by presence of "p" key', () => {
    const fullJson = {
      msg: ['A chunked ', 'description'],
      p: '10.5',
      s: 'on-chain',
      i: ['https://example.com/', 'long-path/image.png'],
      c: 'text',
    };
    const result = parseCip20Fields([], fullJson);
    expect(result.description).toBe('A chunked description');
    expect(result.suggestedPrice).toBe(10.5);
    expect(result.storageLayer).toBe('on-chain');
    expect(result.imageLink).toBe('https://example.com/long-path/image.png');
    expect(result.category).toBe('text');
  });

  it('handles single-element msg and image arrays', () => {
    const fullJson = {
      msg: ['Short desc'],
      p: '5',
      s: 'on-chain',
      i: ['https://img.png'],
      c: 'text',
    };
    const result = parseCip20Fields([], fullJson);
    expect(result.description).toBe('Short desc');
    expect(result.imageLink).toBe('https://img.png');
  });

  it('handles empty description and image chunks', () => {
    const fullJson = { msg: [''], p: '5', s: 'on-chain', i: [''], c: 'text' };
    const result = parseCip20Fields([], fullJson);
    expect(result.description).toBeUndefined();
    expect(result.imageLink).toBeUndefined();
  });

  it('handles missing optional fields gracefully', () => {
    const fullJson = { msg: ['desc'], p: '0', s: '', i: [], c: '' };
    const result = parseCip20Fields([], fullJson);
    expect(result.description).toBe('desc');
    expect(result.suggestedPrice).toBe(0);
    expect(result.storageLayer).toBeUndefined();
    expect(result.imageLink).toBeUndefined();
    expect(result.category).toBeUndefined();
  });

  it('falls back to old format when "p" key is absent', () => {
    const oldMsg = ['A cool item', '10.5', 'on-chain', 'https://img.png', 'text'];
    const result = parseCip20Fields(oldMsg);
    expect(result.description).toBe('A cool item');
    expect(result.suggestedPrice).toBe(10.5);
    expect(result.storageLayer).toBe('on-chain');
  });

  it('falls back to old format when fullJson is undefined', () => {
    const result = parseCip20Fields(['desc', '5', 'on-chain']);
    expect(result.description).toBe('desc');
    expect(result.suggestedPrice).toBe(5);
  });

  it('handles non-numeric price in new format', () => {
    const fullJson = { msg: ['desc'], p: 'not-a-number', s: '', i: [], c: '' };
    const result = parseCip20Fields([], fullJson);
    expect(result.suggestedPrice).toBeUndefined();
  });

  it('handles many description chunks', () => {
    const chunks = Array.from({ length: 8 }, (_, i) => `chunk${i}_`.padEnd(64, 'x'));
    const fullJson = { msg: chunks, p: '100', s: 'data-layer', i: [''], c: 'document' };
    const result = parseCip20Fields([], fullJson);
    expect(result.description).toBe(chunks.join(''));
    expect(result.suggestedPrice).toBe(100);
    expect(result.category).toBe('document');
  });
});

describe('parseBidCip20Fields', () => {
  it('parses valid future price', () => {
    const result = parseBidCip20Fields(['10.5']);
    expect(result.futurePrice).toBe(10.5);
  });

  it('preserves zero price (not treated as falsy)', () => {
    const result = parseBidCip20Fields(['0']);
    expect(result.futurePrice).toBe(0);
  });

  it('returns empty object for empty array', () => {
    const result = parseBidCip20Fields([]);
    expect(result.futurePrice).toBeUndefined();
  });
});
