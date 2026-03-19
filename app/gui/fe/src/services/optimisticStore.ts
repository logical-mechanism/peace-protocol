/**
 * Optimistic UI store — holds pending transaction entries that haven't
 * landed on-chain yet.  Tabs merge these with real API data so the user
 * sees immediate feedback after submitting a transaction.
 *
 * Entries are automatically "graduated" (removed) when their tokenName
 * appears in real chain data, or pruned after a staleness timeout.
 */

import type { EncryptionDisplay, BidDisplay } from './api';

type OptimisticAction = 'add' | 'remove' | 'update';

interface OptimisticEntry<T> {
  action: OptimisticAction;
  tokenName: string;
  txHash: string;
  createdAt: number;
  data?: T;
}

const DEFAULT_MAX_AGE_MS = 300_000; // 5 minutes

class OptimisticStore {
  private encryptions = new Map<string, OptimisticEntry<EncryptionDisplay>>();
  private bids = new Map<string, OptimisticEntry<BidDisplay>>();

  // --- Writers (called from Dashboard tx callbacks) ---

  addEncryption(tokenName: string, txHash: string, data: EncryptionDisplay): void {
    this.encryptions.set(tokenName, {
      action: 'add',
      tokenName,
      txHash,
      createdAt: Date.now(),
      data,
    });
  }

  removeEncryption(tokenName: string, txHash: string): void {
    this.encryptions.set(tokenName, {
      action: 'remove',
      tokenName,
      txHash,
      createdAt: Date.now(),
    });
  }

  updateEncryption(tokenName: string, txHash: string, partial: Partial<EncryptionDisplay>): void {
    this.encryptions.set(tokenName, {
      action: 'update',
      tokenName,
      txHash,
      createdAt: Date.now(),
      data: partial as EncryptionDisplay,
    });
  }

  addBid(tokenName: string, txHash: string, data: BidDisplay): void {
    this.bids.set(tokenName, {
      action: 'add',
      tokenName,
      txHash,
      createdAt: Date.now(),
      data,
    });
  }

  removeBid(tokenName: string, txHash: string): void {
    this.bids.set(tokenName, {
      action: 'remove',
      tokenName,
      txHash,
      createdAt: Date.now(),
    });
  }

  // --- Merge (called by tabs after API fetch) ---

  mergeEncryptions(real: EncryptionDisplay[]): EncryptionDisplay[] {
    if (this.encryptions.size === 0) return real;

    const realTokens = new Set(real.map(e => e.tokenName));
    let result = [...real];

    for (const [tokenName, entry] of this.encryptions) {
      switch (entry.action) {
        case 'add':
          if (realTokens.has(tokenName)) {
            // Chain caught up — graduate
            this.encryptions.delete(tokenName);
          } else if (entry.data) {
            result.push(entry.data);
          }
          break;

        case 'remove':
          if (!realTokens.has(tokenName)) {
            // Chain caught up — graduate
            this.encryptions.delete(tokenName);
          } else {
            result = result.filter(e => e.tokenName !== tokenName);
          }
          break;

        case 'update':
          if (entry.data) {
            const idx = result.findIndex(e => e.tokenName === tokenName);
            if (idx !== -1) {
              const merged = { ...result[idx], ...entry.data, _optimistic: true };
              // Check if real data already has the target status
              const targetStatus = entry.data.status;
              if (targetStatus && result[idx].status === targetStatus) {
                this.encryptions.delete(tokenName);
              } else {
                result[idx] = merged;
              }
            } else {
              // Entry not in real data yet — nothing to update
            }
          }
          break;
      }
    }

    return result;
  }

  mergeBids(real: BidDisplay[]): BidDisplay[] {
    if (this.bids.size === 0) return real;

    const realTokens = new Set(real.map(b => b.tokenName));
    let result = [...real];

    for (const [tokenName, entry] of this.bids) {
      switch (entry.action) {
        case 'add':
          if (realTokens.has(tokenName)) {
            this.bids.delete(tokenName);
          } else if (entry.data) {
            result.push(entry.data);
          }
          break;

        case 'remove':
          if (!realTokens.has(tokenName)) {
            this.bids.delete(tokenName);
          } else {
            result = result.filter(b => b.tokenName !== tokenName);
          }
          break;
      }
    }

    return result;
  }

  // --- Cleanup ---

  pruneStale(maxAgeMs: number = DEFAULT_MAX_AGE_MS): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [key, entry] of this.encryptions) {
      if (entry.createdAt <= cutoff) this.encryptions.delete(key);
    }
    for (const [key, entry] of this.bids) {
      if (entry.createdAt <= cutoff) this.bids.delete(key);
    }
  }

  clear(): void {
    this.encryptions.clear();
    this.bids.clear();
  }

  get size(): number {
    return this.encryptions.size + this.bids.size;
  }
}

/** Shared singleton for optimistic UI state. */
export const optimisticStore = new OptimisticStore();
