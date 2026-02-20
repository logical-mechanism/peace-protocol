/**
 * CBOR → Plutus JSON decoder
 *
 * Decodes raw CBOR bytes into the Plutus JSON schema used by parsers.ts:
 *   Constructor: { constructor: N, fields: [...] }
 *   Integer:     { int: N }
 *   ByteString:  { bytes: "hex" }
 *   List:        { list: [...] }
 *   Map:         { map: [{ k: ..., v: ... }, ...] }
 *
 * Also includes slot-to-time conversion for Cardano networks.
 */

/**
 * Convert a slot number to a Unix timestamp (seconds).
 * Each slot = 1 second. Network-specific Shelley start time.
 */
export function slotToUnixTime(slotNo: number, network: 'preprod' | 'mainnet'): number {
  if (network === 'preprod') {
    // Preprod: Shelley era starts at slot 0, epoch time 1654041600 (2022-06-01T00:00:00Z)
    return 1654041600 + slotNo;
  }
  // Mainnet: Shelley era starts at slot 4492800, epoch time 1596491091 (2020-08-03T21:44:51Z)
  return 1596491091 + (slotNo - 4492800);
}

/**
 * Decode Plutus Data from CBOR hex to Plutus JSON schema.
 */
export function decodePlutusData(cborHex: string): unknown {
  const bytes = hexToBytes(cborHex);
  const [value] = decodeCborItem(bytes, 0);
  return value;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`hexToBytes: odd-length hex string (${hex.length} chars)`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const pair = hex.substring(i * 2, i * 2 + 2);
    const val = parseInt(pair, 16);
    if (Number.isNaN(val)) {
      throw new Error(`hexToBytes: invalid hex chars "${pair}" at position ${i * 2}`);
    }
    bytes[i] = val;
  }
  return bytes;
}

/**
 * Minimal CBOR decoder for Plutus Data structures.
 * Returns [decoded_value, new_offset].
 */
export function decodeCborItem(data: Uint8Array, offset: number): [unknown, number] {
  if (offset >= data.length) {
    throw new Error('CBOR: unexpected end of data');
  }

  const initial = data[offset];
  const majorType = initial >> 5;
  const additional = initial & 0x1f;

  switch (majorType) {
    case 0: { // Unsigned integer
      const [val, newOffset] = decodeRawUint(additional, data, offset + 1);
      return [{ int: val }, newOffset];
    }

    case 1: { // Negative integer: -1 - n
      const [val, newOffset] = decodeRawUint(additional, data, offset + 1);
      return [{ int: -1 - val }, newOffset];
    }

    case 2: { // Byte string
      if (additional === 31) {
        // Indefinite-length byte string: concatenate chunks until break (0xff).
        // Cardano's CBOR encoding splits byte strings >64 bytes into chunks,
        // so all G2 points (96 bytes) use this encoding.
        let hex = '';
        let pos = offset + 1;
        while (data[pos] !== 0xff) {
          const chunkAdditional = data[pos] & 0x1f;
          const [chunkLen, chunkDataOffset] = decodeRawUint(chunkAdditional, data, pos + 1);
          hex += Array.from(data.slice(chunkDataOffset, chunkDataOffset + chunkLen))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          pos = chunkDataOffset + chunkLen;
        }
        return [{ bytes: hex }, pos + 1]; // skip 0xff break
      }
      const [len, dataOffset] = decodeRawUint(additional, data, offset + 1);
      const hex = Array.from(data.slice(dataOffset, dataOffset + len))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return [{ bytes: hex }, dataOffset + len];
    }

    case 3: { // Text string
      const [len, dataOffset] = decodeRawUint(additional, data, offset + 1);
      const text = new TextDecoder().decode(data.slice(dataOffset, dataOffset + len));
      return [text, dataOffset + len];
    }

    case 4: { // Array
      if (additional === 31) {
        // Indefinite-length array: read items until break byte (0xff)
        const items: unknown[] = [];
        let pos = offset + 1;
        while (data[pos] !== 0xff) {
          const [item, newPos] = decodeCborItem(data, pos);
          items.push(item);
          pos = newPos;
        }
        return [{ list: items }, pos + 1]; // skip the 0xff break
      }
      const [len, dataOffset] = decodeRawUint(additional, data, offset + 1);
      const items: unknown[] = [];
      let pos = dataOffset;
      for (let i = 0; i < len; i++) {
        const [item, newPos] = decodeCborItem(data, pos);
        items.push(item);
        pos = newPos;
      }
      return [{ list: items }, pos];
    }

    case 5: { // Map
      if (additional === 31) {
        // Indefinite-length map: read key-value pairs until break byte (0xff)
        const entries: { k: unknown; v: unknown }[] = [];
        let pos = offset + 1;
        while (data[pos] !== 0xff) {
          const [key, keyEnd] = decodeCborItem(data, pos);
          const [val, valEnd] = decodeCborItem(data, keyEnd);
          entries.push({ k: key, v: val });
          pos = valEnd;
        }
        return [{ map: entries }, pos + 1]; // skip the 0xff break
      }
      const [len, dataOffset] = decodeRawUint(additional, data, offset + 1);
      const entries: { k: unknown; v: unknown }[] = [];
      let pos = dataOffset;
      for (let i = 0; i < len; i++) {
        const [key, keyEnd] = decodeCborItem(data, pos);
        const [val, valEnd] = decodeCborItem(data, keyEnd);
        entries.push({ k: key, v: val });
        pos = valEnd;
      }
      return [{ map: entries }, pos];
    }

    case 6: { // Tag (Plutus constructors)
      const [tag, dataOffset] = decodeRawUint(additional, data, offset + 1);
      const [content, contentEnd] = decodeCborItem(data, dataOffset);

      // Tags 121-127 → constructor 0-6
      if (tag >= 121 && tag <= 127) {
        const fields = (content as { list: unknown[] }).list || [];
        return [{ constructor: tag - 121, fields }, contentEnd];
      }

      // Tags 1280-1400 → constructor 7+
      if (tag >= 1280 && tag <= 1400) {
        const fields = (content as { list: unknown[] }).list || [];
        return [{ constructor: tag - 1280 + 7, fields }, contentEnd];
      }

      // Tag 102 → general constructor: [index, fields]
      if (tag === 102) {
        const arr = (content as { list: unknown[] }).list || [];
        const idx = (arr[0] as { int: number }).int;
        const fields = (arr[1] as { list: unknown[] }).list || [];
        return [{ constructor: idx, fields }, contentEnd];
      }

      // Pass through other tags
      return [content, contentEnd];
    }

    default:
      throw new Error(`CBOR: unsupported major type ${majorType} at offset ${offset}`);
  }
}

/** Decode raw unsigned integer from CBOR additional info. Returns [value, new_offset]. */
export function decodeRawUint(additional: number, data: Uint8Array, offset: number): [number, number] {
  if (additional <= 23) {
    return [additional, offset];
  }
  if (additional === 24) {
    return [data[offset], offset + 1];
  }
  if (additional === 25) {
    return [(data[offset] << 8) | data[offset + 1], offset + 2];
  }
  if (additional === 26) {
    return [
      ((data[offset] << 24) >>> 0) + (data[offset + 1] << 16) + (data[offset + 2] << 8) + data[offset + 3],
      offset + 4,
    ];
  }
  if (additional === 27) {
    // 8-byte: use Number (may lose precision for very large values,
    // but Plutus Data integers are typically within safe integer range for lengths)
    let val = 0;
    for (let i = 0; i < 8; i++) {
      val = val * 256 + data[offset + i];
    }
    return [val, offset + 8];
  }
  throw new Error(`CBOR: unsupported additional info ${additional}`);
}
