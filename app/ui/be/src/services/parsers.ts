/**
 * Datum parsers: Plutus JSON (from Koios inline_datum.value) → TypeScript types.
 *
 * Field ordering matches contracts/lib/types/*.ak exactly:
 *   EncryptionDatum: owner_vkh, owner_g1, token, half_level, full_level, capsule, status
 *   BidDatum:        owner_vkh, owner_g1, pointer, token
 *   Register:        generator, public_value
 *   HalfEncLevel:    r1b, r2_g1b, r4b
 *   FullEncLevel:    r1b, r2_g1b, r2_g2b, r4b
 *   Capsule:         nonce, aad, ct
 *   Status:          Open (constructor 0), Pending (constructor 1) → [GrothProof, GrothPublic, Int]
 */

import type {
  EncryptionDatum,
  BidDatum,
  Register,
  HalfEncryptionLevel,
  FullEncryptionLevel,
  Capsule,
  EncryptionStatus,
  GrothProof,
} from '../types/index.js';

// Plutus JSON node types as returned by Koios inline_datum.value
interface PlutusConstr {
  constructor: number;
  fields: PlutusJSON[];
}

interface PlutusBytes {
  bytes: string;
}

interface PlutusInt {
  int: number;
}

interface PlutusList {
  list: PlutusJSON[];
}

type PlutusJSON = PlutusConstr | PlutusBytes | PlutusInt | PlutusList;

function asConstr(v: PlutusJSON): PlutusConstr {
  if ('constructor' in v) return v as PlutusConstr;
  throw new Error(`Expected constructor, got: ${JSON.stringify(v).slice(0, 100)}`);
}

function asBytes(v: PlutusJSON): string {
  if ('bytes' in v) return (v as PlutusBytes).bytes;
  throw new Error(`Expected bytes, got: ${JSON.stringify(v).slice(0, 100)}`);
}

function asInt(v: PlutusJSON): number {
  if ('int' in v) return (v as PlutusInt).int;
  throw new Error(`Expected int, got: ${JSON.stringify(v).slice(0, 100)}`);
}

function asList(v: PlutusJSON): PlutusJSON[] {
  if ('list' in v) return (v as PlutusList).list;
  throw new Error(`Expected list, got: ${JSON.stringify(v).slice(0, 100)}`);
}

function parseRegister(v: PlutusJSON): Register {
  const c = asConstr(v);
  return {
    generator: asBytes(c.fields[0]),
    public_value: asBytes(c.fields[1]),
  };
}

export function parseHalfEncryptionLevel(v: PlutusJSON): HalfEncryptionLevel {
  const c = asConstr(v);
  return {
    r1b: asBytes(c.fields[0]),
    r2_g1b: asBytes(c.fields[1]),
    r4b: asBytes(c.fields[2]),
  };
}

function parseFullEncryptionLevel(v: PlutusJSON): FullEncryptionLevel {
  const c = asConstr(v);
  return {
    r1b: asBytes(c.fields[0]),
    r2_g1b: asBytes(c.fields[1]),
    r2_g2b: asBytes(c.fields[2]),
    r4b: asBytes(c.fields[3]),
  };
}

/**
 * Option<FullEncryptionLevel>:
 *   Some(x) → { constructor: 0, fields: [x] }
 *   None    → { constructor: 1, fields: [] }
 */
export function parseOptionalFullLevel(v: PlutusJSON): FullEncryptionLevel | null {
  const c = asConstr(v);
  if (c.constructor === 1) return null; // None
  return parseFullEncryptionLevel(c.fields[0]);
}

function parseCapsule(v: PlutusJSON): Capsule {
  const c = asConstr(v);
  return {
    nonce: asBytes(c.fields[0]),
    aad: asBytes(c.fields[1]),
    ct: asBytes(c.fields[2]),
  };
}

/**
 * GrothProof:
 *   { constructor: 0, fields: [piA, piB, piC, commitments, commitmentPok] }
 */
function parseGrothProof(v: PlutusJSON): GrothProof {
  const c = asConstr(v);
  return {
    piA: asBytes(c.fields[0]),
    piB: asBytes(c.fields[1]),
    piC: asBytes(c.fields[2]),
    commitments: asList(c.fields[3]).map(asBytes),
    commitmentPok: asBytes(c.fields[4]),
  };
}

/**
 * Status:
 *   Open    → { constructor: 0, fields: [] }
 *   Pending → { constructor: 1, fields: [GrothProof, GrothPublic, Int] }
 *     GrothProof  = constructor 0 with 5 fields
 *     GrothPublic = List<Int>
 */
function parseStatus(v: PlutusJSON): EncryptionStatus {
  const c = asConstr(v);
  if (c.constructor === 0) {
    return { type: 'Open' };
  }
  // Pending: fields[0] is GrothProof, fields[1] is List<Int>, fields[2] is Int
  const groth_proof = parseGrothProof(c.fields[0]);
  const grothPublicList = asList(c.fields[1]);
  const groth_public = grothPublicList.map(asInt);
  const ttl = asInt(c.fields[2]);
  return { type: 'Pending', groth_proof, groth_public, ttl };
}

export function parseEncryptionDatum(datumValue: unknown): EncryptionDatum {
  const v = datumValue as PlutusJSON;
  const c = asConstr(v);
  return {
    owner_vkh: asBytes(c.fields[0]),
    owner_g1: parseRegister(c.fields[1]),
    token: asBytes(c.fields[2]),
    half_level: parseHalfEncryptionLevel(c.fields[3]),
    full_level: parseOptionalFullLevel(c.fields[4]),
    capsule: parseCapsule(c.fields[5]),
    status: parseStatus(c.fields[6]),
  };
}

export function parseBidDatum(datumValue: unknown): BidDatum {
  const v = datumValue as PlutusJSON;
  const c = asConstr(v);
  return {
    owner_vkh: asBytes(c.fields[0]),
    owner_g1: parseRegister(c.fields[1]),
    pointer: asBytes(c.fields[2]),
    token: asBytes(c.fields[3]),
  };
}

export type { PlutusJSON };
