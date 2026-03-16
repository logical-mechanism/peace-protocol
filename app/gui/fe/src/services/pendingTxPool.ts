/**
 * Pending Transaction Pool
 *
 * Tracks submitted-but-unconfirmed transactions and their UTxO effects.
 * After submitting tx A, this pool knows:
 * - Which UTxOs tx A consumed (inputs) — these should be excluded from Kupo results
 * - Which UTxOs tx A created (outputs) — these should be available for tx B
 *
 * This enables transaction chaining: building tx B immediately after tx A
 * without waiting for Kupo to index the on-chain state.
 */

import type { UTxO } from '@meshsdk/core';
import { parseTxInputs, parseTxOutputs, type TxInput } from './txOutputParser';

/** A pending transaction with its UTxO effects */
interface PendingTransaction {
  txHash: string;
  spentInputs: TxInput[];
  createdOutputs: UTxO[];
  submittedAt: number;
  /** TX hashes this tx depends on (its inputs reference another pending tx's outputs) */
  dependsOn: Set<string>;
}

/** Serialize a UTxO reference for deduplication */
function utxoKey(txHash: string, outputIndex: number): string {
  return `${txHash}#${outputIndex}`;
}

export class PendingTxPool {
  private pendingTxs = new Map<string, PendingTransaction>();

  /**
   * Register a submitted transaction with the pool.
   * Parses the CBOR to extract inputs (spent) and outputs (created),
   * and detects dependencies on other pending transactions.
   */
  async registerTx(signedTxCbor: string, txHash: string): Promise<void> {
    if (this.pendingTxs.has(txHash)) return;

    const spentInputs = await parseTxInputs(signedTxCbor);
    const createdOutputs = await parseTxOutputs(signedTxCbor, txHash);

    // Detect dependencies: if any input references another pending tx's output
    const dependsOn = new Set<string>();
    for (const input of spentInputs) {
      if (this.pendingTxs.has(input.txHash)) {
        dependsOn.add(input.txHash);
      }
    }

    this.pendingTxs.set(txHash, {
      txHash,
      spentInputs,
      createdOutputs,
      submittedAt: Date.now(),
      dependsOn,
    });
  }

  /**
   * Check if a UTxO has been spent by a pending transaction.
   */
  isSpent(txHash: string, outputIndex: number): boolean {
    const key = utxoKey(txHash, outputIndex);
    for (const pending of this.pendingTxs.values()) {
      for (const input of pending.spentInputs) {
        if (utxoKey(input.txHash, input.outputIndex) === key) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get pending outputs created by a specific transaction hash.
   * Used by ChainingAdapter.fetchUTxOs(hash) to resolve chained references.
   */
  getPendingOutputsByTxHash(txHash: string): UTxO[] {
    const pending = this.pendingTxs.get(txHash);
    if (!pending) return [];
    // Only return outputs that haven't been spent by a later pending tx
    return pending.createdOutputs.filter(
      (u) => !this.isSpent(u.input.txHash, u.input.outputIndex)
    );
  }

  /**
   * Adjust a set of real Kupo UTxOs by removing spent inputs and adding pending outputs.
   * Optionally filters by address and/or asset.
   *
   * @param realUtxos - UTxOs from Kupo
   * @param address - If provided, only include pending outputs matching this address
   * @param asset - If provided, only include pending outputs containing this asset
   * @returns Merged UTxO set
   */
  getAdjustedUtxos(realUtxos: UTxO[], address?: string, asset?: string): UTxO[] {
    // Remove UTxOs that have been spent by pending txs
    const filtered = realUtxos.filter(
      (u) => !this.isSpent(u.input.txHash, u.input.outputIndex)
    );

    // Collect pending outputs matching address/asset filters
    const pendingOutputs: UTxO[] = [];
    for (const pending of this.pendingTxs.values()) {
      for (const output of pending.createdOutputs) {
        // Skip if this output was consumed by another pending tx
        if (this.isSpent(output.input.txHash, output.input.outputIndex)) continue;

        // Address filter
        if (address && output.output.address !== address) {
          console.log('[PendingTxPool] Address mismatch — pending:', output.output.address, '!== filter:', address);
          continue;
        }

        // Asset filter
        if (asset && !output.output.amount.some((a) => a.unit === asset)) continue;

        pendingOutputs.push(output);
      }
    }

    // Deduplicate: if Kupo caught up and a pending output is now in real results,
    // prefer the real one (it may have additional data like script refs)
    const realKeys = new Set(
      filtered.map((u) => utxoKey(u.input.txHash, u.input.outputIndex))
    );
    const uniquePending = pendingOutputs.filter(
      (u) => !realKeys.has(utxoKey(u.input.txHash, u.input.outputIndex))
    );

    return [...filtered, ...uniquePending];
  }

  /**
   * Remove a confirmed transaction from the pool.
   * Called when Kupo/chain confirms the tx is on-chain.
   */
  confirmTx(txHash: string): void {
    this.pendingTxs.delete(txHash);
    // Also remove dependency references from other pending txs
    for (const pending of this.pendingTxs.values()) {
      pending.dependsOn.delete(txHash);
    }
  }

  /**
   * Invalidate a failed transaction and all transactions that depend on it.
   * Returns the list of all invalidated tx hashes (for UI notification).
   */
  invalidateChain(txHash: string): string[] {
    const invalidated: string[] = [];
    const queue = [txHash];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (!this.pendingTxs.has(current)) continue;

      this.pendingTxs.delete(current);
      invalidated.push(current);

      // Find all txs that depend on this one
      for (const [hash, pending] of this.pendingTxs) {
        if (pending.dependsOn.has(current)) {
          queue.push(hash);
        }
      }
    }

    return invalidated;
  }

  /**
   * Remove pending transactions older than maxAgeMs.
   * Prevents stale virtual UTxOs from blocking future transactions.
   */
  pruneStale(maxAgeMs: number = 300_000): string[] {
    const now = Date.now();
    const pruned: string[] = [];

    for (const [hash, pending] of this.pendingTxs) {
      if (now - pending.submittedAt > maxAgeMs) {
        // Invalidate the entire chain starting from this stale tx
        const invalidated = this.invalidateChain(hash);
        pruned.push(...invalidated);
      }
    }

    return pruned;
  }

  /** Clear all pending transactions. */
  clear(): void {
    this.pendingTxs.clear();
  }

  /** Check if there are any pending transactions. */
  hasPendingTxs(): boolean {
    return this.pendingTxs.size > 0;
  }

  /** Get the number of pending transactions. */
  get size(): number {
    return this.pendingTxs.size;
  }

  /** Get all pending tx hashes (for debugging/UI). */
  getPendingTxHashes(): string[] {
    return [...this.pendingTxs.keys()];
  }
}
