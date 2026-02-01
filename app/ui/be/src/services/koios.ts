import { getNetworkConfig } from '../config/index.js';

interface KoiosUtxo {
  tx_hash: string;
  tx_index: number;
  address: string;
  value: string;
  datum_hash: string | null;
  inline_datum: {
    bytes: string;
    value: unknown;
  } | null;
  reference_script: unknown | null;
  asset_list: Array<{
    policy_id: string;
    asset_name: string;
    quantity: string;
    fingerprint: string;
  }>;
  block_height: number;
  block_time: number;
}

interface KoiosAddressInfo {
  address: string;
  balance: string;
  stake_address: string | null;
  script_address: boolean;
  utxo_set: KoiosUtxo[];
}

class KoiosClient {
  private baseUrl: string;

  constructor() {
    const { koiosUrl } = getNetworkConfig();
    this.baseUrl = koiosUrl;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Koios API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get UTxOs at a specific address
   */
  async getAddressUtxos(address: string): Promise<KoiosUtxo[]> {
    const result = await this.request<KoiosAddressInfo[]>('/address_info', {
      method: 'POST',
      body: JSON.stringify({ _addresses: [address] }),
    });

    return result[0]?.utxo_set || [];
  }

  /**
   * Get UTxOs containing a specific asset
   */
  async getAssetUtxos(policyId: string, assetName?: string): Promise<KoiosUtxo[]> {
    const asset = assetName ? `${policyId}.${assetName}` : policyId;
    const result = await this.request<KoiosAddressInfo[]>('/asset_utxos', {
      method: 'POST',
      body: JSON.stringify({ _asset_list: [[policyId, assetName || '']] }),
    });

    // Flatten all utxo sets
    return result.flatMap(addr => addr.utxo_set || []);
  }

  /**
   * Get transaction info
   */
  async getTxInfo(txHash: string): Promise<unknown> {
    const result = await this.request<unknown[]>('/tx_info', {
      method: 'POST',
      body: JSON.stringify({ _tx_hashes: [txHash] }),
    });

    return result[0];
  }

  /**
   * Get current tip (latest block)
   */
  async getTip(): Promise<{ block_no: number; block_time: number; epoch_no: number }> {
    const result = await this.request<Array<{ block_no: number; block_time: number; epoch_no: number }>>('/tip');
    return result[0];
  }

  /**
   * Get protocol parameters
   */
  async getProtocolParams(): Promise<unknown> {
    const result = await this.request<unknown[]>('/epoch_params?_epoch_no=current');
    return result[0];
  }
}

// Singleton instance
let koiosInstance: KoiosClient | null = null;

export function getKoiosClient(): KoiosClient {
  if (!koiosInstance) {
    koiosInstance = new KoiosClient();
  }
  return koiosInstance;
}

export type { KoiosUtxo, KoiosAddressInfo };
