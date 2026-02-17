/**
 * Kupo HTTP Client (Backend)
 *
 * Queries the local Kupo instance for current UTxO state.
 * Returns data in KoiosUtxo-compatible format so existing
 * services (encryptions.ts, bids.ts) need minimal changes.
 *
 * API reference: https://cardanosolutions.github.io/kupo/
 * Version: v2.11.0
 */

import { config, getNetworkConfig } from '../config/index.js';
import type { KoiosUtxo } from './koios.js';

/** Kupo /matches response item (with ?resolve_hashes) */
interface KupoMatch {
  transaction_index: number;
  transaction_id: string;
  output_index: number;
  address: string;
  value: {
    coins: number;
    assets?: Record<string, number>;
  };
  datum_hash: string | null;
  datum_type?: 'hash' | 'inline';
  /** Present when queried with ?resolve_hashes — CBOR hex */
  datum?: string | null;
  script_hash: string | null;
  created_at: {
    slot_no: number;
    header_hash: string;
  };
  spent_at: {
    slot_no: number;
    header_hash: string;
  } | null;
}

/**
 * Convert a slot number to a Unix timestamp (seconds).
 * Each slot = 1 second. Network-specific Shelley start time.
 */
function slotToUnixTime(slotNo: number, network: 'preprod' | 'mainnet'): number {
  if (network === 'preprod') {
    // Preprod: Shelley era starts at slot 0, epoch time 1654041600 (2022-06-01T00:00:00Z)
    return 1654041600 + slotNo;
  }
  // Mainnet: Shelley era starts at slot 4492800, epoch time 1596491091 (2020-08-03T21:44:51Z)
  return 1596491091 + (slotNo - 4492800);
}

class KupoClient {
  private baseUrl: string;
  private network: 'preprod' | 'mainnet';

  constructor() {
    const { kupoUrl } = getNetworkConfig();
    this.baseUrl = kupoUrl;
    this.network = config.network;
  }

  private async request<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Kupo API error: ${response.status} ${response.statusText} - ${body}`);
    }
    return response.json();
  }

  /**
   * Get UTxOs at a specific address with inline datum data.
   * Uses ?resolve_hashes to include datum CBOR in the response.
   * Returns KoiosUtxo-compatible format for backend service compatibility.
   */
  async getAddressUtxos(address: string): Promise<KoiosUtxo[]> {
    const matches = await this.request<KupoMatch[]>(
      `/matches/${address}?unspent&resolve_hashes`
    );
    return matches.map((m) => this.matchToKoiosUtxo(m));
  }

  /**
   * Get UTxOs containing a specific asset.
   * Kupo can filter by policy_id and asset_name query parameters.
   */
  async getAssetUtxos(policyId: string, assetName?: string): Promise<KoiosUtxo[]> {
    let path = `/matches/*?unspent&resolve_hashes&policy_id=${policyId}`;
    if (assetName) {
      path += `&asset_name=${assetName}`;
    }
    const matches = await this.request<KupoMatch[]>(path);
    return matches.map((m) => this.matchToKoiosUtxo(m));
  }

  /**
   * Convert a Kupo match to KoiosUtxo format for compatibility
   * with existing parsers and services.
   */
  private matchToKoiosUtxo(match: KupoMatch): KoiosUtxo {
    // Convert assets: Kupo "policyId.assetName" → KoiosUtxo asset_list format
    const assetList: KoiosUtxo['asset_list'] = [];
    if (match.value.assets) {
      for (const [key, qty] of Object.entries(match.value.assets)) {
        const dotIndex = key.indexOf('.');
        if (dotIndex === -1) {
          assetList.push({
            policy_id: key,
            asset_name: '',
            quantity: String(qty),
            decimals: 0,
            fingerprint: '',
          });
        } else {
          assetList.push({
            policy_id: key.substring(0, dotIndex),
            asset_name: key.substring(dotIndex + 1),
            quantity: String(qty),
            decimals: 0,
            fingerprint: '',
          });
        }
      }
    }

    // Build inline_datum from resolved datum CBOR
    let inlineDatum: KoiosUtxo['inline_datum'] = null;
    if (match.datum_type === 'inline' && match.datum) {
      inlineDatum = {
        bytes: match.datum,
        value: decodePlutusData(match.datum),
      };
    }

    return {
      tx_hash: match.transaction_id,
      tx_index: match.output_index,
      address: match.address,
      value: String(match.value.coins),
      stake_address: null,
      payment_cred: null,
      epoch_no: 0,
      block_height: 0,
      block_time: slotToUnixTime(match.created_at.slot_no, this.network),
      datum_hash: match.datum_hash,
      inline_datum: inlineDatum,
      reference_script: match.script_hash ? { hash: match.script_hash } : null,
      asset_list: assetList,
      is_spent: false,
    };
  }
}

// --- CBOR → Plutus JSON decoder ---

/**
 * Decode Plutus Data from CBOR hex to Plutus JSON schema.
 *
 * Converts raw CBOR bytes into the format that parsers.ts expects:
 *   Constructor: { constructor: N, fields: [...] }
 *   Integer:     { int: N }
 *   ByteString:  { bytes: "hex" }
 *   List:        { list: [...] }
 *   Map:         { map: [{ k: ..., v: ... }, ...] }
 */
function decodePlutusData(cborHex: string): unknown {
  const bytes = hexToBytes(cborHex);
  const [value] = decodeCborItem(bytes, 0);
  return value;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Minimal CBOR decoder for Plutus Data structures.
 * Returns [decoded_value, new_offset].
 */
function decodeCborItem(data: Uint8Array, offset: number): [unknown, number] {
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
function decodeRawUint(additional: number, data: Uint8Array, offset: number): [number, number] {
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

// Singleton
let kupoInstance: KupoClient | null = null;

export function getKupoClient(): KupoClient {
  if (!kupoInstance) {
    kupoInstance = new KupoClient();
  }
  return kupoInstance;
}
