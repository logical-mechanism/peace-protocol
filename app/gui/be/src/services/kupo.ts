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
import { decodePlutusData, slotToUnixTime } from './cbor.js';

/** Kupo /matches response item (with ?resolve_hashes) */
export interface KupoMatch {
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
 * Convert a Kupo match to KoiosUtxo format for compatibility
 * with existing parsers and services.
 */
export function matchToKoiosUtxo(match: KupoMatch, network: 'preprod' | 'mainnet'): KoiosUtxo {
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
    block_time: slotToUnixTime(match.created_at.slot_no, network),
    datum_hash: match.datum_hash,
    inline_datum: inlineDatum,
    reference_script: match.script_hash ? { hash: match.script_hash } : null,
    asset_list: assetList,
    is_spent: false,
  };
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

  private matchToKoiosUtxo(match: KupoMatch): KoiosUtxo {
    return matchToKoiosUtxo(match, this.network);
  }
}

// Singleton
let kupoInstance: KupoClient | null = null;

export function getKupoClient(): KupoClient {
  if (!kupoInstance) {
    kupoInstance = new KupoClient();
  }
  return kupoInstance;
}
