import { Router } from 'express';
import { getKoiosClient } from '../services/koios.js';
import type { TxInfoWithAssets } from '../services/koios.js';
import { getNetworkConfig } from '../config/index.js';
import { apiCache } from '../services/cache.js';
import { logger } from '../services/logger.js';
import { validateTxHashParam, validatePkhParam } from '../middleware/validate.js';
import { CACHE_TTL_PENDING, CACHE_TTL_CHAIN } from '../config/cacheConstants.js';

const router = Router();

/**
 * Permanent cache: txHash → block_height.
 * Once a tx is in a block, its block_height never changes.
 * Eliminates repeated Koios getTxInfo calls for confirmed txs.
 */
const txBlockHeightCache = new Map<string, number>();

/** Clear the tx block height cache (for testing only). */
export function clearTxBlockHeightCache(): void {
  txBlockHeightCache.clear();
}

/**
 * GET /confirmations/:txHash?tipHeight=N
 *
 * Returns the number of block confirmations for a transaction.
 * Used by the frontend to decide when it's safe to securely delete
 * spent cryptographic secrets (seller a/r, hop a0/r0/hk).
 *
 * tipHeight query param: current chain tip height from local cardano-cli.
 * When provided, avoids a Koios /tip call. Falls back to Koios if missing.
 *
 * Returns { confirmations: 0 } if the tx is not yet in a block.
 */
router.get('/confirmations/:txHash', validateTxHashParam, async (req, res) => {
  try {
    const txHash = req.params.txHash as string;
    const tipHeightParam = req.query.tipHeight ? parseInt(req.query.tipHeight as string, 10) : null;

    // 1. Resolve the tx's block height (cached or Koios)
    let blockHeight = txBlockHeightCache.get(txHash);

    if (blockHeight === undefined) {
      // Check if we recently determined this tx is pending (avoid hammering Koios)
      const pendingCacheKey = `pending_tx_${txHash}`;
      const isPendingCached = apiCache.get<boolean>(pendingCacheKey);
      if (isPendingCached) {
        return res.json({ data: { confirmations: 0, status: 'pending' } });
      }

      // Fetch from Koios
      const koios = getKoiosClient();
      const txInfo = await koios.getTxInfo(txHash).catch(() => null);

      if (!txInfo || typeof txInfo.block_height !== 'number') {
        // Cache "pending" for 15 seconds to avoid repeated Koios calls
        apiCache.set(pendingCacheKey, true, CACHE_TTL_PENDING);
        return res.json({ data: { confirmations: 0, status: 'pending' } });
      }

      blockHeight = txInfo.block_height;
      txBlockHeightCache.set(txHash, blockHeight);
    }

    // 2. Resolve the current tip height (prefer local, fall back to Koios)
    let tipHeight: number;
    if (tipHeightParam && !isNaN(tipHeightParam) && tipHeightParam > 0) {
      tipHeight = tipHeightParam;
    } else {
      const koios = getKoiosClient();
      const tip = await koios.getTip();
      tipHeight = tip.block_no;
    }

    const confirmations = Math.max(0, tipHeight - blockHeight);
    res.set('Cache-Control', 'no-cache');
    return res.json({ data: { confirmations, blockHeight, status: 'confirmed' } });
  } catch (error) {
    logger.error('Failed to get confirmations', { error: String(error), requestId: req.requestId });
    return res.status(503).json({
      error: { code: 'TIP_UNAVAILABLE', message: 'Unable to check transaction confirmations', requestId: req.requestId },
    });
  }
});

/**
 * GET /tip
 *
 * Returns the current network tip from Koios.
 * Used by NodeSync to show "Block X / Y" during sync.
 */
router.get('/tip', async (_req, res) => {
  try {
    const koios = getKoiosClient();
    const tip = await koios.getTip();
    res.set('Cache-Control', 'max-age=30');
    return res.json({
      data: {
        block_no: tip.block_no,
        epoch_no: tip.epoch_no,
        block_time: tip.block_time,
        abs_slot: tip.abs_slot,
      },
    });
  } catch (error) {
    logger.error('Failed to get chain tip', { error: String(error), requestId: _req.requestId });
    return res.status(503).json({
      error: { code: 'TIP_UNAVAILABLE', message: 'Unable to fetch chain tip', requestId: _req.requestId },
    });
  }
});

/**
 * GET /history/:pkh
 *
 * Recovers transaction history from Koios for a payment credential.
 * Intersects user's credential txs with contract address txs to find
 * protocol-related transactions, then classifies by output analysis.
 *
 * Expensive query — cached for 60s. Used on-demand, not for polling.
 */
router.get('/history/:pkh', validatePkhParam, async (req, res) => {
  const pkh = req.params.pkh as string;
  const cacheKey = `history_${pkh}`;

  const cached = apiCache.get<HistoryRecord[]>(cacheKey);
  if (cached) {
    return res.json({ data: cached });
  }

  try {
    const koios = getKoiosClient();
    const { contracts } = getNetworkConfig();

    // 1. Fetch user's credential txs and contract address txs in parallel
    const [credentialTxs, encryptionAddrTxs, biddingAddrTxs] = await Promise.all([
      koios.getCredentialTxs(pkh),
      contracts.encryptionAddress ? koios.getAddressTxs(contracts.encryptionAddress) : Promise.resolve([]),
      contracts.biddingAddress ? koios.getAddressTxs(contracts.biddingAddress) : Promise.resolve([]),
    ]);

    // 2. Intersect: find user txs that touched contract addresses
    const encryptionTxSet = new Set(encryptionAddrTxs.map(t => t.tx_hash));
    const biddingTxSet = new Set(biddingAddrTxs.map(t => t.tx_hash));

    const protocolTxHashes: string[] = [];
    for (const tx of credentialTxs) {
      if (encryptionTxSet.has(tx.tx_hash) || biddingTxSet.has(tx.tx_hash)) {
        protocolTxHashes.push(tx.tx_hash);
      }
    }

    if (protocolTxHashes.length === 0) {
      apiCache.set(cacheKey, [], CACHE_TTL_CHAIN);
      return res.json({ data: [] });
    }

    // 3. Batch fetch full tx info (limit to 50 most recent)
    const recentHashes = protocolTxHashes.slice(0, 50);
    const txInfos = await koios.getTxInfoWithAssets(recentHashes);

    // 4. Classify each tx
    const records: HistoryRecord[] = [];
    for (const tx of txInfos) {
      const record = classifyTx(tx, pkh, contracts, encryptionTxSet, biddingTxSet);
      if (record) {
        records.push(record);
      }
    }

    // Sort newest first
    records.sort((a, b) => b.timestamp - a.timestamp);

    apiCache.set(cacheKey, records, CACHE_TTL_CHAIN);
    return res.json({ data: records });
  } catch (error) {
    logger.error('Failed to recover history', { error: String(error), pkh, requestId: req.requestId });

    // Try stale cache
    const stale = apiCache.getStale<HistoryRecord[]>(cacheKey);
    if (stale) {
      return res.json({ data: stale });
    }

    return res.status(503).json({
      error: { code: 'HISTORY_UNAVAILABLE', message: 'Unable to recover transaction history', requestId: req.requestId },
    });
  }
});

interface HistoryRecord {
  txHash: string;
  type: string;
  tokenName?: string;
  timestamp: number;
  status: 'confirmed';
  description?: string;
  amountLovelace?: number;
  counterparty?: string;
  confirmedAtBlock?: number;
}

/**
 * Classify a transaction by analyzing which contract addresses its outputs target
 * and what assets appear. Uses output addresses + asset lists for classification.
 */
function classifyTx(
  tx: TxInfoWithAssets,
  userPkh: string,
  contracts: ReturnType<typeof getNetworkConfig>['contracts'],
  encryptionTxSet: Set<string>,
  biddingTxSet: Set<string>,
): HistoryRecord | null {
  const isEncryptionTx = encryptionTxSet.has(tx.tx_hash);
  const isBiddingTx = biddingTxSet.has(tx.tx_hash);
  const timestamp = tx.block_time * 1000; // Koios returns seconds

  // Check outputs for contract addresses and extract token info
  let encryptionTokenName: string | undefined;
  let bidTokenName: string | undefined;
  let bidAmount: number | undefined;
  let counterpartyPkh: string | undefined;

  for (const out of tx.outputs) {
    const outAddr = out.payment_addr?.bech32 || '';
    const outCred = out.payment_addr?.cred || '';

    if (outAddr === contracts.encryptionAddress && out.asset_list) {
      // Output to encryption contract — find the encryption token
      const encToken = out.asset_list.find(a => a.policy_id === contracts.encryptionPolicyId);
      if (encToken) {
        encryptionTokenName = encToken.asset_name;
      }
      // If the output cred doesn't match user, it's a counterparty
      if (outCred && outCred !== userPkh) {
        counterpartyPkh = outCred;
      }
    }

    if (outAddr === contracts.biddingAddress && out.asset_list) {
      // Output to bidding contract — find the bid token
      const bidToken = out.asset_list.find(a => a.policy_id === contracts.biddingPolicyId);
      if (bidToken) {
        bidTokenName = bidToken.asset_name;
      }
      bidAmount = parseInt(out.value || '0', 10);
    }
  }

  // Extract description from CIP-20 metadata (key 674)
  let description: string | undefined;
  if (tx.metadata && typeof tx.metadata === 'object') {
    const cip20 = tx.metadata['674'] as Record<string, unknown> | undefined;
    if (cip20) {
      if (Array.isArray(cip20.msg)) {
        description = cip20.msg.join('');
      } else if (typeof cip20.p === 'string') {
        // Structured format: description in msg array, price in p
        if (Array.isArray(cip20.msg)) {
          description = cip20.msg.join('');
        }
      }
    }
  }

  // Classify based on contract involvement and whether user is sender/receiver
  const userIsInput = tx.inputs?.some(inp => inp.payment_addr?.cred === userPkh) ?? false;

  if (isBiddingTx && !isEncryptionTx) {
    // Pure bidding tx
    if (bidTokenName && !userIsInput) {
      // User didn't provide inputs to bidding contract but tx is at bidding address
      // This shouldn't happen for the user's own credential txs, skip
      return null;
    }

    if (bidTokenName) {
      // Output has a bid token at the bidding address
      return {
        txHash: tx.tx_hash,
        type: 'place-bid',
        tokenName: bidTokenName,
        timestamp,
        status: 'confirmed',
        description: description || `Bid on listing`,
        amountLovelace: bidAmount,
        confirmedAtBlock: tx.block_height,
      };
    } else if (userIsInput) {
      // User consumed from bidding but no bid token in outputs → cancel-bid
      return {
        txHash: tx.tx_hash,
        type: 'cancel-bid',
        timestamp,
        status: 'confirmed',
        description: description || 'Cancel bid',
        confirmedAtBlock: tx.block_height,
      };
    }
  }

  if (isEncryptionTx && !isBiddingTx) {
    // Pure encryption tx
    if (encryptionTokenName && !userIsInput) {
      // Shouldn't happen for user's credential txs
      return null;
    }

    if (encryptionTokenName) {
      // Output has encryption token → could be create-listing or complete-sale
      return {
        txHash: tx.tx_hash,
        type: 'create-listing',
        tokenName: encryptionTokenName,
        timestamp,
        status: 'confirmed',
        description: description || `Listing ${encryptionTokenName.slice(0, 12)}...`,
        confirmedAtBlock: tx.block_height,
      };
    } else if (userIsInput) {
      // User consumed from encryption but no token in outputs → remove-listing
      return {
        txHash: tx.tx_hash,
        type: 'remove-listing',
        timestamp,
        status: 'confirmed',
        description: description || 'Remove listing',
        confirmedAtBlock: tx.block_height,
      };
    }
  }

  if (isEncryptionTx && isBiddingTx) {
    // Tx touches both contracts → accept-bid or complete-sale
    return {
      txHash: tx.tx_hash,
      type: 'accept-bid',
      tokenName: encryptionTokenName || bidTokenName,
      timestamp,
      status: 'confirmed',
      description: description || 'Accept bid',
      amountLovelace: bidAmount,
      counterparty: counterpartyPkh,
      confirmedAtBlock: tx.block_height,
    };
  }

  // Couldn't classify
  return null;
}

export default router;
