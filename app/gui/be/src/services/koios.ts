import { getNetworkConfig } from '../config/index.js';

interface KoiosUtxo {
  tx_hash: string;
  tx_index: number;
  address: string;
  value: string;
  stake_address: string | null;
  payment_cred: string | null;
  epoch_no: number;
  block_height: number;
  block_time: number;
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
    decimals: number;
    fingerprint: string;
  }>;
  is_spent: boolean;
}

interface TxOutput {
  payment_addr: {
    bech32: string;
    cred: string;
  };
  value: string;
  inline_datum: {
    bytes: string;
    value: unknown;
  } | null;
}

interface TxInfo {
  tx_hash: string;
  block_height: number;
  outputs: TxOutput[];
}

class KoiosClient {
  private baseUrl: string;
  private authToken: string;

  constructor() {
    const { koiosUrl, koiosToken } = getNetworkConfig();
    this.baseUrl = koiosUrl;
    this.authToken = koiosToken;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options?.headers as Record<string, string>),
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Koios API error: ${response.status} ${response.statusText} - ${body}`);
    }

    return response.json();
  }

  /**
   * Get UTxOs at a specific address with inline datum data.
   * Uses _extended=true to populate inline_datum fields.
   */
  async getAddressUtxos(address: string): Promise<KoiosUtxo[]> {
    return this.request<KoiosUtxo[]>('/address_utxos', {
      method: 'POST',
      body: JSON.stringify({
        _addresses: [address],
        _extended: true,
      }),
    });
  }

  /**
   * Get UTxOs containing a specific asset
   */
  async getAssetUtxos(policyId: string, assetName?: string): Promise<KoiosUtxo[]> {
    return this.request<KoiosUtxo[]>('/asset_utxos', {
      method: 'POST',
      body: JSON.stringify({
        _asset_list: [[policyId, assetName || '']],
        _extended: true,
      }),
    });
  }

  /**
   * Get transaction info
   */
  async getTxInfo(txHash: string): Promise<unknown> {
    const result = await this.request<unknown[]>('/tx_info', {
      method: 'POST',
      body: JSON.stringify({ _tx_hashes: [txHash] }),
    });

    if (result.length === 0) {
      throw new Error(`Transaction not found: ${txHash}`);
    }
    return result[0];
  }

  /**
   * Get transaction metadata
   */
  async getTxMetadata(txHash: string): Promise<Array<{ key: string; json: unknown }>> {
    const result = await this.request<Array<{ tx_hash: string; metadata: Record<string, unknown> | null }>>('/tx_metadata', {
      method: 'POST',
      body: JSON.stringify({ _tx_hashes: [txHash] }),
    });

    const rawMetadata = result[0]?.metadata;
    if (!rawMetadata || typeof rawMetadata !== 'object') return [];

    // Koios returns metadata as an object { "674": {...} }, convert to array format
    return Object.entries(rawMetadata).map(([key, json]) => ({ key, json }));
  }

  /**
   * Get all transaction hashes for an asset (with full history).
   * Used for building decryption levels across re-encryption hops.
   */
  async getAssetTxs(policyId: string, assetName: string): Promise<Array<{ tx_hash: string; block_height: number }>> {
    return this.request<Array<{ tx_hash: string; block_height: number }>>(
      `/asset_txs?_asset_policy=${policyId}&_asset_name=${assetName}&_history=true`
    );
  }

  /**
   * Get transaction info for multiple tx hashes (batch).
   * Returns outputs with inline datums for extracting encryption levels.
   * Matches the flags used in commands/08_decryptMessage.sh.
   */
  async getTxInfoBatch(txHashes: string[]): Promise<TxInfo[]> {
    if (txHashes.length === 0) return [];
    return this.request<TxInfo[]>('/tx_info', {
      method: 'POST',
      body: JSON.stringify({
        _tx_hashes: txHashes,
        _inputs: false,
        _metadata: false,
        _assets: false,
        _withdrawals: false,
        _certs: false,
        _scripts: true,
        _bytecode: false,
      }),
    });
  }

  /**
   * Get current tip (latest block)
   */
  async getTip(): Promise<{ block_no: number; block_time: number; epoch_no: number }> {
    const result = await this.request<Array<{ block_no: number; block_time: number; epoch_no: number }>>('/tip');
    if (result.length === 0) {
      throw new Error('No tip data returned from Koios');
    }
    return result[0];
  }

  /**
   * Get protocol parameters
   */
  async getProtocolParams(): Promise<unknown> {
    // Koios GET /epoch_params returns latest epoch params when no _epoch_no specified
    const result = await this.request<unknown[]>('/epoch_params');
    if (result.length === 0) {
      throw new Error('No protocol parameters returned from Koios');
    }
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

export type { KoiosUtxo };
