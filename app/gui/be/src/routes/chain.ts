import { Router } from 'express';
import { getKoiosClient } from '../services/koios.js';
import type { TxInfoWithAssets } from '../services/koios.js';
import { getNetworkConfig } from '../config/index.js';
import { apiCache } from '../services/cache.js';
import { logger } from '../services/logger.js';
import { validateTxHashParam, validatePkhParam } from '../middleware/validate.js';
import { CACHE_TTL_PENDING, CACHE_TTL_CHAIN } from '../config/cacheConstants.js';
import { parseEncryptionDatum } from '../services/parsers.js';

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

/**
 * GET /activity/:pkh
 *
 * Returns the user's plain wallet activity (non-protocol ADA transfers) classified
 * as `send` (user's PKH appears in inputs) or `receive` (user's PKH only in outputs).
 *
 * Complements `/history/:pkh` which surfaces protocol-related txs only. Together they
 * give the History tab a complete view of a payment credential's on-chain activity.
 *
 * Cached for 60s.
 */
router.get('/activity/:pkh', validatePkhParam, async (req, res) => {
  const pkh = req.params.pkh as string;
  const cacheKey = `activity_${pkh}`;

  const cached = apiCache.get<HistoryRecord[]>(cacheKey);
  if (cached) {
    return res.json({ data: cached });
  }

  try {
    const koios = getKoiosClient();
    const { contracts } = getNetworkConfig();

    const [credentialTxs, encryptionAddrTxs, biddingAddrTxs] = await Promise.all([
      koios.getCredentialTxs(pkh),
      contracts.encryptionAddress ? koios.getAddressTxs(contracts.encryptionAddress) : Promise.resolve([]),
      contracts.biddingAddress ? koios.getAddressTxs(contracts.biddingAddress) : Promise.resolve([]),
    ]);

    // Exclude txs that touch protocol contracts — those are surfaced by /history/:pkh.
    const protocolHashSet = new Set<string>([
      ...encryptionAddrTxs.map(t => t.tx_hash),
      ...biddingAddrTxs.map(t => t.tx_hash),
    ]);

    const activityHashes = credentialTxs
      .filter(t => !protocolHashSet.has(t.tx_hash))
      .slice(0, 50)
      .map(t => t.tx_hash);

    logger.info('Wallet activity query', {
      pkh,
      credentialTxCount: credentialTxs.length,
      protocolHashCount: protocolHashSet.size,
      activityHashCount: activityHashes.length,
      firstHashes: activityHashes.slice(0, 3),
      requestId: req.requestId,
    });

    if (activityHashes.length === 0) {
      return res.json({ data: [] });
    }

    const txInfos = await koios.getTxInfoWithAssets(activityHashes);

    const records: HistoryRecord[] = [];
    for (const tx of txInfos) {
      const record = classifyActivityTx(tx, pkh);
      if (record) records.push(record);
    }

    records.sort((a, b) => b.timestamp - a.timestamp);

    logger.info('Wallet activity classified', {
      pkh,
      txInfoCount: txInfos.length,
      recordCount: records.length,
      sampleTypes: records.slice(0, 5).map(r => `${r.type}:${r.txHash.slice(0, 8)}`),
      requestId: req.requestId,
    });

    if (records.length > 0) {
      apiCache.set(cacheKey, records, CACHE_TTL_CHAIN);
    }
    res.set('Cache-Control', 'no-cache');
    return res.json({ data: records });
  } catch (error) {
    logger.error('Failed to fetch wallet activity', { error: String(error), pkh, requestId: req.requestId });

    const stale = apiCache.getStale<HistoryRecord[]>(cacheKey);
    if (stale) {
      return res.json({ data: stale });
    }

    return res.status(503).json({
      error: { code: 'ACTIVITY_UNAVAILABLE', message: 'Unable to fetch wallet activity', requestId: req.requestId },
    });
  }
});

/**
 * GET /reencryption-history/:pkh
 *
 * Returns one row per completed re-encryption transaction the user
 * participated in — either as the bidder (Purchase) or as the listing
 * owner (Sale). Re-encryption is the post-SNARK transaction where the
 * bid UTxO is consumed and the encryption is transferred to the buyer;
 * it's the canonical tax-record event since it carries both datums and
 * the actual lovelace exchanged. Re-sales by other users (where the
 * caller is not on either side) are excluded.
 *
 * Cached for 60s. Expensive — one Koios /tx_info per intersected tx,
 * gated by encryption ∩ bidding address activity.
 */
router.get('/reencryption-history/:pkh', validatePkhParam, async (req, res) => {
  const pkh = req.params.pkh as string;
  const cacheKey = `reencryption_history_${pkh}`;

  const cached = apiCache.get<ReencryptionEvent[]>(cacheKey);
  if (cached) {
    return res.json({ data: cached });
  }

  try {
    const koios = getKoiosClient();
    const { contracts } = getNetworkConfig();

    const [encryptionAddrTxs, biddingAddrTxs] = await Promise.all([
      contracts.encryptionAddress ? koios.getAddressTxs(contracts.encryptionAddress) : Promise.resolve([]),
      contracts.biddingAddress ? koios.getAddressTxs(contracts.biddingAddress) : Promise.resolve([]),
    ]);

    // Re-encryption candidates are txs that touch BOTH contracts.
    const encryptionTxSet = new Set(encryptionAddrTxs.map((t) => t.tx_hash));
    const candidates: string[] = [];
    for (const t of biddingAddrTxs) {
      if (encryptionTxSet.has(t.tx_hash)) candidates.push(t.tx_hash);
    }

    logger.info('reencryption-history: candidate scan', {
      pkh,
      encryptionTxs: encryptionAddrTxs.length,
      biddingTxs: biddingAddrTxs.length,
      candidates: candidates.length,
      requestId: req.requestId,
    });

    if (candidates.length === 0) {
      apiCache.set(cacheKey, [], CACHE_TTL_CHAIN);
      return res.json({ data: [] });
    }

    // Cap the workload — most users won't accumulate hundreds of
    // re-encryptions, and the upper bound protects Koios from a runaway
    // batch query when the contracts are heavily used by other users.
    const recent = candidates.slice(0, 200);
    const txInfos = await koios.getTxInfoWithAssets(recent);

    const events: ReencryptionEvent[] = [];
    let skipNoBidInput = 0;
    let skipNoSellerInput = 0;
    let skipNoBuyerOutput = 0;
    let skipParseFail = 0;
    for (const tx of txInfos) {
      const result = extractReencryptionEvent(tx, contracts);
      if (typeof result === 'string') {
        if (result === 'no-bid-input') skipNoBidInput++;
        else if (result === 'no-seller-input') skipNoSellerInput++;
        else if (result === 'no-buyer-output') skipNoBuyerOutput++;
        else if (result === 'parse-fail') skipParseFail++;
        continue;
      }
      if (result.buyerPkh === pkh || result.sellerPkh === pkh) {
        events.push(result);
      }
    }

    logger.info('reencryption-history: extraction summary', {
      pkh,
      fetched: txInfos.length,
      extracted: txInfos.length - skipNoBidInput - skipNoSellerInput - skipNoBuyerOutput - skipParseFail,
      skipNoBidInput,
      skipNoSellerInput,
      skipNoBuyerOutput,
      skipParseFail,
      matchedUser: events.length,
      requestId: req.requestId,
    });

    events.sort((a, b) => b.timestamp - a.timestamp);

    apiCache.set(cacheKey, events, CACHE_TTL_CHAIN);
    return res.json({ data: events });
  } catch (error) {
    logger.error('Failed to fetch reencryption history', { error: String(error), pkh, requestId: req.requestId });

    const stale = apiCache.getStale<ReencryptionEvent[]>(cacheKey);
    if (stale) {
      return res.json({ data: stale });
    }

    return res.status(503).json({
      error: { code: 'REENCRYPTION_HISTORY_UNAVAILABLE', message: 'Unable to fetch re-encryption history', requestId: req.requestId },
    });
  }
});

/**
 * GET /utxos/:address
 *
 * Returns UTxOs at an address from Koios. Used to fill the gap when Kupo
 * starts from a --since point and misses pre-deployment wallet UTxOs.
 * Response shape matches MeshSDK UTxO format for direct frontend consumption.
 */
router.get('/utxos/:address', async (req, res) => {
  const address = req.params.address as string;

  // Basic bech32 address validation
  if (!address.startsWith('addr') || address.length < 40) {
    return res.status(400).json({
      error: { code: 'INVALID_PARAM', message: 'Invalid address format' },
    });
  }

  try {
    const koios = getKoiosClient();
    const utxos = await koios.getAddressUtxos(address);

    const meshUtxos = utxos
      .filter(u => !u.is_spent)
      .map(u => {
        const amount: Array<{ unit: string; quantity: string }> = [
          { unit: 'lovelace', quantity: u.value },
        ];

        if (u.asset_list) {
          for (const asset of u.asset_list) {
            amount.push({
              unit: asset.policy_id + asset.asset_name,
              quantity: asset.quantity,
            });
          }
        }

        return {
          input: {
            txHash: u.tx_hash,
            outputIndex: u.tx_index,
          },
          output: {
            address: u.address,
            amount,
            dataHash: u.datum_hash ?? undefined,
            plutusData: u.inline_datum?.bytes ?? undefined,
          },
        };
      });

    res.set('Cache-Control', `max-age=${CACHE_TTL_CHAIN}`);
    return res.json({ data: meshUtxos });
  } catch (error) {
    logger.error('Failed to fetch wallet UTxOs from Koios', { error: String(error), requestId: req.requestId });
    return res.status(503).json({
      error: { code: 'UTXO_UNAVAILABLE', message: 'Unable to fetch wallet UTxOs', requestId: req.requestId },
    });
  }
});

/**
 * GET /utxo-info/:txHash
 *
 * Look up all unspent UTxOs from a transaction via Koios.
 * Fallback for fetchUTxOs when Kupo doesn't have a UTxO (predates --since).
 * Queries indices 0-9 via Koios utxo_info to cover typical transactions.
 */
router.get('/utxo-info/:txHash', async (req, res) => {
  const { txHash } = req.params;

  if (!/^[0-9a-f]{64}$/.test(txHash as string)) {
    return res.status(400).json({
      error: { code: 'INVALID_PARAM', message: 'Invalid txHash format' },
    });
  }

  try {
    const koios = getKoiosClient();
    // Query indices 0-9 to cover typical transaction output counts
    const refs = Array.from({ length: 10 }, (_, i) => `${txHash}#${i}`);
    const utxos = await koios.getUtxoInfo(refs);

    const meshUtxos = utxos
      .filter(u => !u.is_spent)
      .map(u => {
        const amount: Array<{ unit: string; quantity: string }> = [
          { unit: 'lovelace', quantity: u.value },
        ];
        if (u.asset_list) {
          for (const asset of u.asset_list) {
            amount.push({
              unit: asset.policy_id + asset.asset_name,
              quantity: asset.quantity,
            });
          }
        }

        let scriptRef: string | undefined;
        if (u.reference_script && typeof u.reference_script === 'object') {
          const rs = u.reference_script as Record<string, unknown>;
          if (typeof rs.bytes === 'string') {
            scriptRef = rs.bytes;
          }
        }

        return {
          input: { txHash: u.tx_hash, outputIndex: u.tx_index },
          output: {
            address: u.address,
            amount,
            dataHash: u.datum_hash ?? undefined,
            plutusData: u.inline_datum?.bytes ?? undefined,
            scriptRef,
          },
        };
      });

    res.set('Cache-Control', `max-age=${CACHE_TTL_CHAIN}`);
    return res.json({ data: meshUtxos });
  } catch (error) {
    logger.error('Failed to fetch UTxO info from Koios', { error: String(error), requestId: req.requestId });
    return res.status(503).json({
      error: { code: 'UTXO_UNAVAILABLE', message: 'Unable to fetch UTxO info', requestId: req.requestId },
    });
  }
});

export interface ReencryptionEvent {
  txHash: string;
  blockHeight: number;
  /** Block time in milliseconds (Koios returns seconds). */
  timestamp: number;
  encryptionTokenName: string;
  /** New owner of the encryption (the bidder whose bid was accepted). */
  buyerPkh: string;
  /** Listing owner before re-encryption (signs the tx, receives the lovelace). */
  sellerPkh: string;
  /** Lovelace consumed from the bid UTxO — the amount the buyer paid. */
  bidAmountLovelace: number;
  /** Forward price set on the new encryption datum (resale ask). */
  futurePriceLovelace: number;
}

/** Reason codes returned when an extraction is skipped — surfaced in the
 * route handler's summary log so empty exports can be debugged without
 * round-tripping through stored Koios responses. */
type ExtractSkipReason = 'no-bid-input' | 'no-seller-input' | 'no-buyer-output' | 'parse-fail';

/**
 * Extract a re-encryption event from a tx that touches both contracts.
 * Re-encryption tx shape:
 *   - inputs: bid UTxO at biddingAddress (lovelace = bid amount), listing UTxO at encryptionAddress
 *   - outputs: new encryption UTxO at encryptionAddress (datum.owner_vkh = buyerPkh, .new_price = future price),
 *              wallet payment to seller (lovelace = bid amount), seller's change/collateral
 *
 * Contract inputs/outputs are identified primarily by **asset policy**
 * because Koios doesn't always populate `payment_addr.bech32` on inputs
 * — the bid UTxO carries a bidding-policy asset, the encryption UTxO
 * carries an encryption-policy asset. `bech32` is kept as a fallback
 * for environments where the policy carve-out is unreliable.
 *
 * Seller PKH is recovered from the first non-contract input — the seller
 * is the only party who signs and provides funding for fees, so any
 * non-contract input cred is theirs (limitation noted in the route docs).
 */
function extractReencryptionEvent(
  tx: TxInfoWithAssets,
  contracts: ReturnType<typeof getNetworkConfig>['contracts'],
): ReencryptionEvent | ExtractSkipReason {
  if (!contracts.encryptionAddress || !contracts.biddingAddress) return 'no-bid-input';
  if (!contracts.encryptionPolicyId || !contracts.biddingPolicyId) return 'no-bid-input';

  const isBiddingInput = (inp: NonNullable<TxInfoWithAssets['inputs']>[number]) =>
    inp.asset_list?.some((a) => a.policy_id === contracts.biddingPolicyId) ||
    inp.payment_addr?.bech32 === contracts.biddingAddress;

  const isContractInput = (inp: NonNullable<TxInfoWithAssets['inputs']>[number]) =>
    inp.asset_list?.some(
      (a) => a.policy_id === contracts.biddingPolicyId || a.policy_id === contracts.encryptionPolicyId,
    ) ||
    inp.payment_addr?.bech32 === contracts.biddingAddress ||
    inp.payment_addr?.bech32 === contracts.encryptionAddress;

  let bidAmountLovelace = 0;
  let foundBidInput = false;
  for (const inp of tx.inputs ?? []) {
    if (isBiddingInput(inp)) {
      bidAmountLovelace = parseInt(inp.value || '0', 10) || 0;
      foundBidInput = true;
      break;
    }
  }
  if (!foundBidInput) return 'no-bid-input';

  let sellerPkh = '';
  for (const inp of tx.inputs ?? []) {
    const cred = inp.payment_addr?.cred;
    if (!cred) continue;
    if (isContractInput(inp)) continue;
    sellerPkh = cred;
    break;
  }
  if (!sellerPkh) return 'no-seller-input';

  let buyerPkh = '';
  let encryptionTokenName = '';
  let futurePriceLovelace = 0;
  let sawEncryptionOutput = false;
  let parseFailed = false;
  for (const out of tx.outputs) {
    const matchesByAddress = out.payment_addr?.bech32 === contracts.encryptionAddress;
    const matchesByPolicy = out.asset_list?.some((a) => a.policy_id === contracts.encryptionPolicyId);
    if (!matchesByAddress && !matchesByPolicy) continue;
    sawEncryptionOutput = true;
    if (!out.inline_datum?.value) continue;
    try {
      const datum = parseEncryptionDatum(out.inline_datum.value);
      buyerPkh = datum.owner_vkh;
      futurePriceLovelace = datum.new_price;
    } catch (err) {
      parseFailed = true;
      logger.warn('reencryption-history: encryption datum parse failed', {
        tx: tx.tx_hash,
        error: String(err),
      });
      continue;
    }
    if (out.asset_list) {
      const encAsset = out.asset_list.find((a) => a.policy_id === contracts.encryptionPolicyId);
      if (encAsset) encryptionTokenName = encAsset.asset_name;
    }
    break;
  }
  if (!buyerPkh || !encryptionTokenName) {
    if (parseFailed) return 'parse-fail';
    if (!sawEncryptionOutput) return 'no-buyer-output';
    return 'no-buyer-output';
  }

  const epochSeconds = tx.tx_timestamp ?? tx.block_time ?? 0;
  return {
    txHash: tx.tx_hash,
    blockHeight: tx.block_height,
    timestamp: epochSeconds * 1000,
    encryptionTokenName,
    buyerPkh,
    sellerPkh,
    bidAmountLovelace,
    futurePriceLovelace,
  };
}

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
  const epochSeconds = tx.tx_timestamp ?? tx.block_time ?? 0;
  const timestamp = epochSeconds * 1000; // Koios returns seconds

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

/**
 * Classify a non-protocol tx as a `send` or `receive` for the user's payment credential.
 *
 * - If the user's PKH appears in any input → `send` (user authorized this tx).
 * - Otherwise the user only appears in outputs → `receive`.
 *
 * Net amount is the user's lovelace delta (sum of user outputs minus sum of user inputs).
 * Counterparty is the first non-user input PKH for receives, or the first non-user output
 * PKH for sends.
 */
export function classifyActivityTx(tx: TxInfoWithAssets, userPkh: string): HistoryRecord | null {
  const epochSeconds = tx.tx_timestamp ?? tx.block_time ?? 0;
  const timestamp = epochSeconds * 1000;

  let userInputLovelace = 0;
  let userOutputLovelace = 0;
  const userInInputs = tx.inputs?.some(inp => inp.payment_addr?.cred === userPkh) ?? false;

  for (const inp of tx.inputs ?? []) {
    if (inp.payment_addr?.cred === userPkh) {
      userInputLovelace += parseInt(inp.value || '0', 10) || 0;
    }
  }
  for (const out of tx.outputs) {
    if (out.payment_addr?.cred === userPkh) {
      userOutputLovelace += parseInt(out.value || '0', 10) || 0;
    }
  }

  const net = userOutputLovelace - userInputLovelace;

  if (userInInputs) {
    // Send: prefer the first non-user output as counterparty
    const counterpartyPkh = tx.outputs.find(
      o => o.payment_addr?.cred && o.payment_addr.cred !== userPkh,
    )?.payment_addr?.cred;
    return {
      txHash: tx.tx_hash,
      type: 'send',
      timestamp,
      status: 'confirmed',
      amountLovelace: Math.abs(net),
      counterparty: counterpartyPkh,
      confirmedAtBlock: tx.block_height,
    };
  }

  // Receive: counterparty is the first non-user input
  const counterpartyPkh = tx.inputs?.find(
    i => i.payment_addr?.cred && i.payment_addr.cred !== userPkh,
  )?.payment_addr?.cred;
  return {
    txHash: tx.tx_hash,
    type: 'receive',
    timestamp,
    status: 'confirmed',
    amountLovelace: net > 0 ? net : userOutputLovelace,
    counterparty: counterpartyPkh,
    confirmedAtBlock: tx.block_height,
  };
}

export default router;
