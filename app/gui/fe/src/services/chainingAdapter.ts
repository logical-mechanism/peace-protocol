/**
 * Chaining Adapter
 *
 * Wraps the KupoAdapter (real on-chain UTxO fetcher) and overlays
 * pending transaction state from the PendingTxPool. This allows
 * transaction chaining: building tx B using outputs from submitted-
 * but-unconfirmed tx A.
 *
 * Implements MeshSDK's IFetcher interface so it can be used as a
 * drop-in replacement for KupoAdapter in MeshTxBuilder and MeshWallet.
 */

import type { IFetcher } from '@meshsdk/core';
import type {
  UTxO,
  AccountInfo,
  Asset,
  AssetMetadata,
  BlockInfo,
  Protocol,
  TransactionInfo,
  GovernanceProposalInfo,
} from '@meshsdk/core';
import type { KupoAdapter } from './kupoAdapter';
import type { PendingTxPool } from './pendingTxPool';

export class ChainingAdapter implements IFetcher {
  constructor(
    private realAdapter: KupoAdapter,
    private pool: PendingTxPool,
  ) {}

  /**
   * Fetch UTxOs at an address, optionally filtered by asset.
   * Overlays pending state: removes spent inputs, adds pending outputs.
   */
  async fetchAddressUTxOs(address: string, asset?: string): Promise<UTxO[]> {
    const real = await this.realAdapter.fetchAddressUTxOs(address, asset);
    return this.pool.getAdjustedUtxos(real, address, asset);
  }

  /**
   * Fetch UTxOs by transaction hash and optional output index.
   * If the hash matches a pending transaction, returns its virtual outputs.
   * Otherwise delegates to real Kupo and filters out spent UTxOs.
   */
  async fetchUTxOs(hash: string, index?: number): Promise<UTxO[]> {
    // Check pending pool first — enables chained tx references
    const pending = this.pool.getPendingOutputsByTxHash(hash);
    if (pending.length > 0) {
      if (index !== undefined) {
        return pending.filter((u) => u.input.outputIndex === index);
      }
      return pending;
    }

    // Fall through to real Kupo
    const real = await this.realAdapter.fetchUTxOs(hash, index);
    return real.filter(
      (u) => !this.pool.isSpent(u.input.txHash, u.input.outputIndex)
    );
  }

  /** Passthrough to real adapter */
  async get(url: string): Promise<unknown> {
    return this.realAdapter.get(url);
  }

  // --- Delegate unimplemented IFetcher methods to real adapter ---

  async fetchAccountInfo(address: string): Promise<AccountInfo> {
    return this.realAdapter.fetchAccountInfo(address);
  }

  async fetchAssetAddresses(asset: string): Promise<{ address: string; quantity: string }[]> {
    return this.realAdapter.fetchAssetAddresses(asset);
  }

  async fetchAssetMetadata(asset: string): Promise<AssetMetadata> {
    return this.realAdapter.fetchAssetMetadata(asset);
  }

  async fetchBlockInfo(hash: string): Promise<BlockInfo> {
    return this.realAdapter.fetchBlockInfo(hash);
  }

  async fetchCollectionAssets(
    policyId: string,
    cursor?: number | string,
  ): Promise<{ assets: Asset[]; next?: string | number | null }> {
    return this.realAdapter.fetchCollectionAssets(policyId, cursor);
  }

  async fetchProtocolParameters(epoch: number): Promise<Protocol> {
    return this.realAdapter.fetchProtocolParameters(epoch);
  }

  async fetchTxInfo(hash: string): Promise<TransactionInfo> {
    return this.realAdapter.fetchTxInfo(hash);
  }

  async fetchGovernanceProposal(
    txHash: string,
    certIndex: number,
  ): Promise<GovernanceProposalInfo> {
    return this.realAdapter.fetchGovernanceProposal(txHash, certIndex);
  }
}
