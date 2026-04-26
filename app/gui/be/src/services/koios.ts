import { getNetworkConfig } from '../config/index.js';
import { fetchWithRetry } from './fetchWithRetry.js';
import { CircuitBreaker } from './circuitBreaker.js';
import { logger } from './logger.js';

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
  tx_block_index?: number;
  outputs: TxOutput[];
}

interface TxAsset {
  policy_id: string;
  asset_name: string;
  quantity: string;
}

interface TxInfoWithAssets {
  tx_hash: string;
  block_height: number;
  // Koios /tx_info uses `tx_timestamp` (UNIX seconds); some older / mocked
  // responses use `block_time`. Read both — never assume only one is set.
  tx_timestamp?: number;
  block_time?: number;
  tx_block_index?: number;
  inputs?: Array<{
    tx_hash: string;
    tx_index: number;
    payment_addr?: { bech32?: string; cred: string };
    value?: string;
    asset_list?: TxAsset[];
  }>;
  outputs: Array<TxOutput & { asset_list?: TxAsset[] }>;
  metadata?: Record<string, unknown> | null;
}

class KoiosClient {
  private baseUrl: string;
  private authToken: string;
  private circuitBreaker: CircuitBreaker;

  constructor() {
    const { koiosUrl, koiosToken } = getNetworkConfig();
    this.baseUrl = koiosUrl;
    this.authToken = koiosToken;
    this.circuitBreaker = new CircuitBreaker({
      name: 'koios',
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
    });
  }

  private async request<T>(endpoint: string, options?: RequestInit, signal?: AbortSignal): Promise<T> {
    return this.circuitBreaker.execute(async () => {
      const url = `${this.baseUrl}${endpoint}`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }

      const response = await fetchWithRetry(url, {
        ...options,
        headers: {
          ...headers,
          ...(options?.headers as Record<string, string>),
        },
        ...(signal && { signal }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const msg = `Koios API error: ${response.status} ${response.statusText} - ${body.slice(0, 500)}`;
        logger.error('Koios request failed', { endpoint: url, status: response.status, body: body.slice(0, 500) });
        throw new Error(msg);
      }

      return response.json();
    });
  }

  /**
   * Get UTxOs at a specific address with inline datum data.
   * Uses _extended=true to populate inline_datum fields.
   */
  async getAddressUtxos(address: string, signal?: AbortSignal): Promise<KoiosUtxo[]> {
    return this.request<KoiosUtxo[]>('/address_utxos', {
      method: 'POST',
      body: JSON.stringify({
        _addresses: [address],
        _extended: true,
      }),
    }, signal);
  }

  /**
   * Look up specific UTxOs by tx_hash#tx_index.
   * Used as fallback when Kupo doesn't have a UTxO (predates --since).
   */
  async getUtxoInfo(utxoRefs: string[], signal?: AbortSignal): Promise<KoiosUtxo[]> {
    if (utxoRefs.length === 0) return [];
    return this.request<KoiosUtxo[]>('/utxo_info', {
      method: 'POST',
      body: JSON.stringify({
        _utxo_refs: utxoRefs,
        _extended: true,
      }),
    }, signal);
  }

  /**
   * Get UTxOs containing a specific asset
   */
  async getAssetUtxos(policyId: string, assetName?: string, signal?: AbortSignal): Promise<KoiosUtxo[]> {
    return this.request<KoiosUtxo[]>('/asset_utxos', {
      method: 'POST',
      body: JSON.stringify({
        _asset_list: [[policyId, assetName || '']],
        _extended: true,
      }),
    }, signal);
  }

  /**
   * Get transaction info
   */
  async getTxInfo(txHash: string, signal?: AbortSignal): Promise<TxInfo> {
    const result = await this.request<TxInfo[]>('/tx_info', {
      method: 'POST',
      body: JSON.stringify({ _tx_hashes: [txHash] }),
    }, signal);

    if (result.length === 0) {
      throw new Error(`Transaction not found: ${txHash}`);
    }
    return result[0];
  }

  /**
   * Get transaction metadata
   */
  async getTxMetadata(txHash: string, signal?: AbortSignal): Promise<Array<{ key: string; json: unknown }>> {
    const result = await this.request<Array<{ tx_hash: string; metadata: Record<string, unknown> | null }>>('/tx_metadata', {
      method: 'POST',
      body: JSON.stringify({ _tx_hashes: [txHash] }),
    }, signal);

    const rawMetadata = result[0]?.metadata;
    if (!rawMetadata || typeof rawMetadata !== 'object') return [];

    // Koios returns metadata as an object { "674": {...} }, convert to array format
    return Object.entries(rawMetadata).map(([key, json]) => ({ key, json }));
  }

  /**
   * Get transaction metadata for multiple tx hashes (batch).
   * Returns a Map of txHash → metadata entries array.
   */
  async getTxMetadataBatch(txHashes: string[], signal?: AbortSignal): Promise<Map<string, Array<{ key: string; json: unknown }>>> {
    if (txHashes.length === 0) return new Map();

    const results = await this.request<Array<{ tx_hash: string; metadata: Record<string, unknown> | null }>>(
      '/tx_metadata',
      {
        method: 'POST',
        body: JSON.stringify({ _tx_hashes: txHashes }),
      },
      signal,
    );

    const metadataMap = new Map<string, Array<{ key: string; json: unknown }>>();

    for (const item of results) {
      const rawMetadata = item.metadata;
      if (!rawMetadata || typeof rawMetadata !== 'object') {
        metadataMap.set(item.tx_hash, []);
        continue;
      }
      const entries = Object.entries(rawMetadata).map(([key, json]) => ({ key, json }));
      metadataMap.set(item.tx_hash, entries);
    }

    return metadataMap;
  }

  /**
   * Get all transaction hashes for an asset (with full history).
   * Used for building decryption levels across re-encryption hops.
   */
  async getAssetTxs(policyId: string, assetName: string, signal?: AbortSignal): Promise<Array<{ tx_hash: string; block_height: number }>> {
    return this.request<Array<{ tx_hash: string; block_height: number }>>(
      `/asset_txs?_asset_policy=${policyId}&_asset_name=${assetName}&_history=true`,
      undefined,
      signal,
    );
  }

  /**
   * Get all transaction hashes at an address (fallback when asset_txs is unavailable).
   * Returns ALL txs at the address — caller must filter by token.
   */
  async getAddressTxs(address: string, signal?: AbortSignal): Promise<Array<{ tx_hash: string; block_height: number }>> {
    return this.request<Array<{ tx_hash: string; block_height: number }>>(
      '/address_txs',
      {
        method: 'POST',
        body: JSON.stringify({ _addresses: [address] }),
      },
      signal,
    );
  }

  /**
   * Get transaction info for multiple tx hashes (batch).
   * Returns outputs with inline datums for extracting encryption levels.
   * Matches the flags used in commands/08_decryptMessage.sh.
   */
  async getTxInfoBatch(txHashes: string[], signal?: AbortSignal): Promise<TxInfo[]> {
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
    }, signal);
  }

  /**
   * Get current tip (latest block)
   */
  async getTip(signal?: AbortSignal): Promise<{ block_no: number; block_time: number; epoch_no: number; abs_slot: number }> {
    const result = await this.request<Array<{ block_no: number; block_time: number; epoch_no: number; abs_slot: number }>>('/tip', undefined, signal);
    if (result.length === 0) {
      throw new Error('No tip data returned from Koios');
    }
    return result[0];
  }

  /**
   * Get protocol parameters
   */
  async getProtocolParams(signal?: AbortSignal): Promise<Record<string, unknown>> {
    // Koios GET /epoch_params returns latest epoch params when no _epoch_no specified
    const result = await this.request<Record<string, unknown>[]>('/epoch_params', undefined, signal);
    if (result.length === 0) {
      throw new Error('No protocol parameters returned from Koios');
    }
    return result[0];
  }

  /**
   * Get all transaction hashes for a payment credential.
   * Returns ALL txs where this credential appeared as input or output.
   */
  async getCredentialTxs(pkh: string, signal?: AbortSignal): Promise<Array<{ tx_hash: string; block_height: number; block_time: number }>> {
    return this.request<Array<{ tx_hash: string; block_height: number; block_time: number }>>(
      '/credential_txs',
      {
        method: 'POST',
        body: JSON.stringify({ _payment_credentials: [pkh] }),
      },
      signal,
    );
  }

  /**
   * Get full transaction info for multiple tx hashes including asset data.
   * Used for history recovery — classifies txs by minted/burned assets.
   */
  async getTxInfoWithAssets(txHashes: string[], signal?: AbortSignal): Promise<TxInfoWithAssets[]> {
    if (txHashes.length === 0) return [];
    return this.request<TxInfoWithAssets[]>('/tx_info', {
      method: 'POST',
      body: JSON.stringify({
        _tx_hashes: txHashes,
        _inputs: true,
        _metadata: true,
        _assets: true,
        _withdrawals: false,
        _certs: false,
        _scripts: false,
        _bytecode: false,
      }),
    }, signal);
  }

  getCircuitBreakerState() {
    return {
      state: this.circuitBreaker.currentState,
      failureCount: this.circuitBreaker.consecutiveFailures,
    };
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

export type { KoiosUtxo, TxInfoWithAssets };
