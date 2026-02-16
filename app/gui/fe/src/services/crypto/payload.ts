/**
 * Peace Protocol Standardized Encrypted Payload
 *
 * Builds and parses CBOR-encoded payloads following the peace-payload CDDL schema:
 *   { 0 => bstr, ? 1 => bstr, ? 2 => bstr, * int => bstr }
 *
 * Uses canonical CBOR encoding (RFC 8949 §4.2) via cborg to produce
 * byte-identical output to Python's cbor2 with canonical=True.
 *
 * Copyright (C) 2025 Logical Mechanism LLC
 * SPDX-License-Identifier: GPL-3.0-only
 */

import * as cborg from 'cborg';
import { hexToBytes, bytesToHex } from './bls12381';

/**
 * Structured payload fields for building a peace-payload.
 */
export interface PayloadFields {
  /** Field 0 (required): content address — IPFS CID, Arweave TX ID, URL, or inline data */
  locator: Uint8Array;
  /** Field 1 (optional): access/decryption key for off-chain content */
  secret?: Uint8Array;
  /** Field 2 (optional): integrity hash of the underlying content */
  digest?: Uint8Array;
  /** Fields 3+ (optional): application-specific extension fields */
  extra?: Map<number, Uint8Array>;
}

/**
 * Build a canonical CBOR-encoded peace-payload map.
 *
 * @param fields - Structured payload fields
 * @returns Canonical CBOR bytes (deterministic encoding)
 * @throws Error if extra contains reserved keys (0, 1, 2)
 */
export function buildPayload(fields: PayloadFields): Uint8Array {
  const map = new Map<number, Uint8Array>();
  map.set(0, fields.locator);
  if (fields.secret !== undefined) {
    map.set(1, fields.secret);
  }
  if (fields.digest !== undefined) {
    map.set(2, fields.digest);
  }
  if (fields.extra) {
    for (const [k, v] of fields.extra) {
      if (k === 0 || k === 1 || k === 2) {
        throw new Error(`Extra key ${k} conflicts with reserved keys (0, 1, 2)`);
      }
      map.set(k, v);
    }
  }
  return cborg.encode(map);
}

/**
 * Parse a CBOR-encoded peace-payload map.
 *
 * Validates that the decoded value is a map with integer keys and
 * Uint8Array values, and that field 0 (locator) is present.
 *
 * @param data - Raw CBOR bytes
 * @returns Map of integer keys to Uint8Array values
 * @throws Error if structure doesn't match peace-payload schema
 */
export function parsePayload(data: Uint8Array): Map<number, Uint8Array> {
  const decoded = cborg.decode(data, { useMaps: true });
  if (!(decoded instanceof Map)) {
    throw new Error(`Expected CBOR map, got ${typeof decoded}`);
  }
  if (!decoded.has(0)) {
    throw new Error('Missing required field 0 (locator)');
  }
  for (const [k, v] of decoded) {
    if (typeof k !== 'number') {
      throw new Error(`All keys must be int, got ${typeof k}`);
    }
    if (!(v instanceof Uint8Array)) {
      throw new Error(`All values must be bytes, got ${typeof v} for key ${k}`);
    }
  }
  return decoded as Map<number, Uint8Array>;
}

/**
 * Build a peace-payload from hex-encoded field values.
 *
 * @param fields - Object with hex-encoded field values
 * @returns Hex-encoded canonical CBOR
 */
export function buildPayloadHex(fields: {
  locator: string;
  secret?: string;
  digest?: string;
}): string {
  return bytesToHex(
    buildPayload({
      locator: hexToBytes(fields.locator),
      secret: fields.secret ? hexToBytes(fields.secret) : undefined,
      digest: fields.digest ? hexToBytes(fields.digest) : undefined,
    })
  );
}

/**
 * Parse a hex-encoded CBOR peace-payload into hex-encoded fields.
 *
 * @param hex - Hex-encoded CBOR bytes
 * @returns Object with hex-encoded field values
 */
export function parsePayloadHex(hex: string): {
  locator: string;
  secret?: string;
  digest?: string;
  extra?: Record<number, string>;
} {
  const m = parsePayload(hexToBytes(hex));
  const result: {
    locator: string;
    secret?: string;
    digest?: string;
    extra?: Record<number, string>;
  } = {
    locator: bytesToHex(m.get(0)!),
  };
  if (m.has(1)) result.secret = bytesToHex(m.get(1)!);
  if (m.has(2)) result.digest = bytesToHex(m.get(2)!);
  for (const [k, v] of m) {
    if (k >= 3) {
      if (!result.extra) result.extra = {};
      result.extra[k] = bytesToHex(v);
    }
  }
  return result;
}
