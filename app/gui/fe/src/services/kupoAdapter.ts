/**
 * Kupo HTTP Adapter
 *
 * Implements MeshSDK's IFetcher interface by translating
 * Kupo REST API responses into MeshSDK UTxO format.
 *
 * Kupo runs locally at http://127.0.0.1:44203 as a managed
 * process (started by Tauri in Phase 2).
 *
 * All HTTP requests are routed through Tauri IPC (invoke → reqwest)
 * to bypass WebKitGTK CORS enforcement. Kupo serves no CORS headers,
 * and different WebKitGTK versions handle cross-scheme requests differently.
 *
 * API reference: https://cardanosolutions.github.io/kupo/
 */

import { invoke } from '@tauri-apps/api/core';
import type { IFetcher } from '@meshsdk/core';
import type {
  UTxO,
  Asset,
  AccountInfo,
  AssetMetadata,
  BlockInfo,
  Protocol,
  TransactionInfo,
  GovernanceProposalInfo,
} from '@meshsdk/core';
import { chainApi } from './api';

/** Kupo /matches response item */
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
  /** Present when queried with ?resolve_datums — CBOR hex */
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

/** Kupo GET /scripts/{hash} response */
interface KupoScript {
  script: string;
  language: string;
}

export class KupoAdapter implements IFetcher {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://127.0.0.1:44203') {
    this.baseUrl = baseUrl;
  }

  /**
   * Fetch UTxOs at an address, optionally filtered by asset.
   * Kupo is the sole source of truth for current UTxO state.
   *
   * Queries: GET /matches/{address}?unspent&resolve_hashes
   */
  async fetchAddressUTxOs(address: string, asset?: string): Promise<UTxO[]> {
    const matches = await this.queryMatches(address);
    const utxos = await Promise.all(matches.map((m) => this.matchToUtxo(m)));

    if (asset) {
      return utxos.filter((u) =>
        u.output.amount.some((a) => a.unit === asset)
      );
    }

    return utxos;
  }

  /**
   * Fetch UTxOs by transaction hash and optional output index.
   * Falls back to a live Koios lookup when Kupo doesn't have the UTxO
   * (e.g. pre --since UTxOs like reference scripts).
   *
   * Queries: GET /matches/{index}@{hash}?unspent&resolve_hashes
   */
  async fetchUTxOs(hash: string, index?: number): Promise<UTxO[]> {
    const pattern = index !== undefined ? `${index}@${hash}` : `*@${hash}`;
    const matches = await this.queryMatches(pattern);
    const results = await Promise.all(matches.map((m) => this.matchToUtxo(m)));

    if (results.length > 0) return results;

    // Kupo doesn't have it — live Koios fallback for pre-since UTxOs.
    const koiosUtxos = await chainApi.getUtxosByTxHash(hash);
    if (koiosUtxos.length > 0) {
      const mapped = koiosUtxos.map((ku) => ({
        input: ku.input,
        output: {
          address: ku.output.address,
          amount: ku.output.amount,
          dataHash: ku.output.dataHash,
          plutusData: ku.output.plutusData,
          scriptRef: ku.output.scriptRef,
        },
      }));
      if (index !== undefined) {
        return mapped.filter((u) => u.input.outputIndex === index);
      }
      return mapped;
    }

    return results;
  }

  /** Raw HTTP GET passthrough (routed through Tauri IPC). */
  async get(url: string): Promise<unknown> {
    const body = await invoke<string>('kupo_fetch', { url });
    return JSON.parse(body);
  }

  // --- Unimplemented IFetcher methods (not used in this codebase) ---

  async fetchAccountInfo(_address: string): Promise<AccountInfo> {
    throw new Error('KupoAdapter.fetchAccountInfo not implemented — use Koios');
  }

  async fetchAssetAddresses(_asset: string): Promise<{ address: string; quantity: string }[]> {
    throw new Error('KupoAdapter.fetchAssetAddresses not implemented');
  }

  async fetchAssetMetadata(_asset: string): Promise<AssetMetadata> {
    throw new Error('KupoAdapter.fetchAssetMetadata not implemented');
  }

  async fetchBlockInfo(_hash: string): Promise<BlockInfo> {
    throw new Error('KupoAdapter.fetchBlockInfo not implemented');
  }

  async fetchCollectionAssets(
    _policyId: string,
    _cursor?: number | string
  ): Promise<{ assets: Asset[]; next?: string | number | null }> {
    throw new Error('KupoAdapter.fetchCollectionAssets not implemented');
  }

  async fetchProtocolParameters(_epoch: number): Promise<Protocol> {
    throw new Error('KupoAdapter.fetchProtocolParameters not implemented — use OgmiosProvider');
  }

  async fetchTxInfo(_hash: string): Promise<TransactionInfo> {
    throw new Error('KupoAdapter.fetchTxInfo not implemented — use Koios');
  }

  async fetchGovernanceProposal(
    _txHash: string,
    _certIndex: number
  ): Promise<GovernanceProposalInfo> {
    throw new Error('KupoAdapter.fetchGovernanceProposal not implemented');
  }

  // --- Private helpers ---

  /**
   * Query Kupo /matches with resolve_hashes to get inline datum CBOR
   * in the same response (avoids extra /datums/ roundtrips).
   */
  private async queryMatches(pattern: string): Promise<KupoMatch[]> {
    const url = `${this.baseUrl}/matches/${pattern}?unspent&resolve_hashes`;
    const body = await invoke<string>('kupo_fetch', { url });
    return JSON.parse(body);
  }

  /**
   * Fetch script CBOR from Kupo's /scripts/{hash} endpoint.
   * Returns the hex-encoded script bytes, or undefined if not found.
   */
  private async fetchScript(scriptHash: string): Promise<string | undefined> {
    const url = `${this.baseUrl}/scripts/${scriptHash}`;
    try {
      const body = await invoke<string>('kupo_fetch', { url });
      const data: KupoScript = JSON.parse(body);
      return data.script ?? undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Convert a Kupo match to a MeshSDK UTxO.
   * If the match has a script_hash, fetches the script CBOR separately.
   */
  private async matchToUtxo(match: KupoMatch): Promise<UTxO> {
    // Build amount array: lovelace first
    const amount: Asset[] = [
      { unit: 'lovelace', quantity: String(match.value.coins) },
    ];

    // Convert assets: Kupo keys are "policyId.assetName" (dot-separated)
    // MeshSDK unit is policyId + assetName (concatenated, no separator)
    if (match.value.assets) {
      for (const [key, qty] of Object.entries(match.value.assets)) {
        const dotIndex = key.indexOf('.');
        if (dotIndex === -1) {
          // Policy-only token (empty asset name)
          amount.push({ unit: key, quantity: String(qty) });
        } else {
          const policyId = key.substring(0, dotIndex);
          const assetName = key.substring(dotIndex + 1);
          amount.push({ unit: policyId + assetName, quantity: String(qty) });
        }
      }
    }

    // Inline datum CBOR from resolved datum (or from separate /datums/ fetch)
    let plutusData: string | undefined;
    if (match.datum_type === 'inline' && match.datum) {
      plutusData = match.datum;
    }

    // Fetch script CBOR from /scripts/{hash} for reference script UTxOs
    let scriptRef: string | undefined;
    if (match.script_hash) {
      scriptRef = await this.fetchScript(match.script_hash);
    }

    return {
      input: {
        txHash: match.transaction_id,
        outputIndex: match.output_index,
      },
      output: {
        address: match.address,
        amount,
        dataHash: match.datum_hash ?? undefined,
        plutusData,
        scriptHash: match.script_hash ?? undefined,
        scriptRef,
      },
    };
  }
}
