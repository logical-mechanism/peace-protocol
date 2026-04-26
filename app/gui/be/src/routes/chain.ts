import { Router } from 'express';
import { getKoiosClient } from '../services/koios.js';
import type { TxInfoWithAssets, KoiosUtxo } from '../services/koios.js';
import { getNetworkConfig } from '../config/index.js';
import { apiCache } from '../services/cache.js';
import { logger } from '../services/logger.js';
import { validateTxHashParam, validatePkhParam } from '../middleware/validate.js';
import { CACHE_TTL_PENDING, CACHE_TTL_CHAIN } from '../config/cacheConstants.js';
import { parseEncryptionDatum } from '../services/parsers.js';
import { decodePlutusData } from '../services/cbor.js';

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
 * POST /reencryption-history/:pkh
 *
 * Returns one row per completed re-encryption tx the user participated
 * in — as bidder (Purchase) or as listing owner (Sale). Re-encryption
 * is the post-SNARK transaction that consumes the bid UTxO and
 * transfers the encryption to the buyer; it carries both datums and
 * the lovelace exchanged, so it's the canonical tax event.
 *
 * Candidate sourcing (avoids the contract-address intersection that
 * silently dropped txs when /address_txs paginated past the user's
 * activity):
 *   - Buyer side: caller posts `encryptionTokens` — the encryption
 *     tokens the user has bid on (frontend gets these from
 *     listBidSecretTokens). Backend walks each token's full asset
 *     history via /asset_txs; the user's purchase re-encryption is
 *     in there regardless of whether they still own the token.
 *   - Seller side: getCredentialTxs(pkh) returns every tx the user
 *     signed; the seller signs the re-encryption, so this captures
 *     all sales (including resales of previously-purchased items).
 *
 * Both sets feed into extractReencryptionEvent; rows where the caller
 * is the buyer or seller are returned. Cached for 60s.
 */
router.post('/reencryption-history/:pkh', validatePkhParam, async (req, res) => {
  const pkh = req.params.pkh as string;
  const requestedTokens = Array.isArray(req.body?.encryptionTokens) ? req.body.encryptionTokens : [];
  const encryptionTokens: string[] = requestedTokens
    .filter((t: unknown): t is string => typeof t === 'string' && /^[0-9a-f]{0,128}$/.test(t));
  const cacheKey = `reencryption_history_${pkh}_${encryptionTokens.slice().sort().join(',')}`;

  const cached = apiCache.get<ReencryptionEvent[]>(cacheKey);
  if (cached) {
    return res.json({ data: cached });
  }

  try {
    const koios = getKoiosClient();
    const { contracts } = getNetworkConfig();

    if (!contracts.encryptionPolicyId) {
      return res.status(503).json({
        error: { code: 'CONTRACT_CONFIG_MISSING', message: 'Encryption policy ID not configured', requestId: req.requestId },
      });
    }

    // Buyer side: every tx that ever touched a token the user bid on.
    // Run per-token fetches in parallel — a heavy bidder can have a
    // dozen+ tokens and the sequential version pushed us into 30s+
    // total wall time before /tx_info even started.
    const buyerSideHashes = new Set<string>();
    const buyerResults = await Promise.allSettled(
      encryptionTokens.map((tokenName) =>
        koios.getAssetTxs(contracts.encryptionPolicyId, tokenName),
      ),
    );
    buyerResults.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        for (const t of r.value) buyerSideHashes.add(t.tx_hash);
      } else {
        logger.warn('reencryption-history: getAssetTxs failed for token', {
          tokenName: encryptionTokens[i],
          error: String(r.reason),
          requestId: req.requestId,
        });
      }
    });

    // Seller side: every tx the user's payment credential signed.
    let sellerSideHashes = new Set<string>();
    try {
      const credTxs = await koios.getCredentialTxs(pkh);
      sellerSideHashes = new Set(credTxs.map((t) => t.tx_hash));
    } catch (err) {
      logger.warn('reencryption-history: getCredentialTxs failed', {
        error: String(err),
        requestId: req.requestId,
      });
    }

    const candidateHashes = new Set<string>([...buyerSideHashes, ...sellerSideHashes]);

    logger.info('reencryption-history: candidate scan', {
      pkh,
      encryptionTokens: encryptionTokens.length,
      buyerSideHashes: buyerSideHashes.size,
      sellerSideHashes: sellerSideHashes.size,
      candidates: candidateHashes.size,
      requestId: req.requestId,
    });

    if (candidateHashes.size === 0) {
      apiCache.set(cacheKey, [], CACHE_TTL_CHAIN);
      return res.json({ data: [] });
    }

    // Chunk the /tx_info batch fetch — Koios's POST /tx_info has a
    // practical limit around 50 hashes per call, and a heavy user's
    // getCredentialTxs can run into the hundreds. Cap the total
    // candidates and split into chunks of 50 so a single large user
    // doesn't get a 503 from Koios.
    const CHUNK = 50;
    const CAP = 500;
    const recent = [...candidateHashes].slice(0, CAP);
    const txInfos: Awaited<ReturnType<typeof koios.getTxInfoWithAssets>> = [];
    for (let i = 0; i < recent.length; i += CHUNK) {
      const chunk = recent.slice(i, i + CHUNK);
      try {
        const part = await koios.getTxInfoWithAssets(chunk);
        txInfos.push(...part);
      } catch (err) {
        logger.warn('reencryption-history: getTxInfoWithAssets chunk failed', {
          chunkStart: i,
          chunkSize: chunk.length,
          error: String(err),
          requestId: req.requestId,
        });
      }
    }

    const events: ReencryptionEvent[] = [];
    const partials: PartialReencryptionEvent[] = [];
    let skipNoBidInput = 0;
    let skipNoEncryptionOutput = 0;
    let skipEncOutputNoDatum = 0;
    let skipEncOutputNoBuyerPkh = 0;
    let skipEncOutputNoTokenName = 0;
    let skipParseFail = 0;
    let extractedNoSeller = 0;
    for (const tx of txInfos) {
      const result = extractReencryptionEvent(tx, contracts);
      if (result.kind === 'skip') {
        const reason = result.reason;
        if (reason === 'no-bid-input') skipNoBidInput++;
        else if (reason === 'no-encryption-output') skipNoEncryptionOutput++;
        else if (reason === 'encryption-output-no-datum') skipEncOutputNoDatum++;
        else if (reason === 'encryption-output-no-buyer-pkh') skipEncOutputNoBuyerPkh++;
        else if (reason === 'encryption-output-no-token-name') skipEncOutputNoTokenName++;
        else if (reason === 'parse-fail') skipParseFail++;
        continue;
      }
      if (result.kind === 'partial') {
        partials.push(result.value);
        continue;
      }
      const evt = result.value;
      if (!evt.sellerPkh) extractedNoSeller++;
      events.push(evt);
    }

    // Second pass: re-fetch encryption outputs whose inline_datum was
    // stripped by /tx_info. /utxo_info with `_extended: true` reliably
    // returns inline_datum.bytes for any size — same endpoint the existing
    // /utxo-info/:txHash route uses. One batched call regardless of count.
    let backfilled = 0;
    let backfillNoDatum = 0;
    let backfillParseFail = 0;
    if (partials.length > 0) {
      const refs = partials.map((p) => `${p.txHash}#${p.encryptionOutputIndex}`);
      let utxos: KoiosUtxo[] = [];
      try {
        utxos = await koios.getUtxoInfo(refs);
      } catch (err) {
        logger.warn('reencryption-history: utxo_info backfill failed', {
          refs: refs.length,
          error: String(err),
          requestId: req.requestId,
        });
      }
      const utxoByRef = new Map<string, KoiosUtxo>();
      for (const u of utxos) utxoByRef.set(`${u.tx_hash}#${u.tx_index}`, u);

      logger.info('reencryption-history: utxo_info backfill', {
        requestId: req.requestId,
        sentRefs: refs.length,
        receivedUtxos: utxos.length,
        missingRefs: refs.filter((r) => !utxoByRef.has(r)).length,
      });

      for (const p of partials) {
        const ref = `${p.txHash}#${p.encryptionOutputIndex}`;
        const u = utxoByRef.get(ref);
        const inlineBytes = u?.inline_datum?.bytes;
        const inlineValue = u?.inline_datum?.value;
        let datumValue: unknown = inlineValue;
        if (!datumValue && inlineBytes) {
          try {
            datumValue = decodePlutusData(inlineBytes);
          } catch (err) {
            logger.warn('reencryption-history: backfill CBOR decode failed', {
              ref,
              error: String(err),
            });
          }
        }
        if (!datumValue) {
          backfillNoDatum++;
          skipEncOutputNoDatum++;
          continue;
        }
        let buyerPkh = '';
        let futurePriceLovelace = 0;
        try {
          const datum = parseEncryptionDatum(datumValue);
          buyerPkh = datum.owner_vkh;
          futurePriceLovelace = datum.new_price;
        } catch (err) {
          backfillParseFail++;
          skipParseFail++;
          logger.warn('reencryption-history: backfill datum parse failed', {
            ref,
            error: String(err),
          });
          continue;
        }
        let encryptionTokenName = p.encryptionTokenNameHint;
        if (!encryptionTokenName && u?.asset_list) {
          const encAsset = u.asset_list.find((a) => a.policy_id === contracts.encryptionPolicyId);
          if (encAsset) encryptionTokenName = encAsset.asset_name;
        }
        if (!buyerPkh || !encryptionTokenName) {
          if (!buyerPkh) skipEncOutputNoBuyerPkh++;
          else skipEncOutputNoTokenName++;
          continue;
        }
        backfilled++;
        const evt: ReencryptionEvent = {
          txHash: p.txHash,
          blockHeight: p.blockHeight,
          timestamp: p.timestamp,
          encryptionTokenName,
          buyerPkh,
          sellerPkh: p.sellerPkh,
          bidAmountLovelace: p.bidAmountLovelace,
          futurePriceLovelace,
        };
        if (!evt.sellerPkh) extractedNoSeller++;
        events.push(evt);
      }
    }

    const lowerPkh = pkh.toLowerCase();
    const matchedEvents = events.filter(
      (e) => e.buyerPkh.toLowerCase() === lowerPkh || e.sellerPkh.toLowerCase() === lowerPkh,
    );

    const meta = {
      encryptionTokens: encryptionTokens.length,
      buyerSideHashes: buyerSideHashes.size,
      sellerSideHashes: sellerSideHashes.size,
      candidates: candidateHashes.size,
      fetched: txInfos.length,
      extracted: events.length,
      partials: partials.length,
      backfilled,
      backfillNoDatum,
      backfillParseFail,
      skipNoBidInput,
      skipNoEncryptionOutput,
      skipEncOutputNoDatum,
      skipEncOutputNoBuyerPkh,
      skipEncOutputNoTokenName,
      skipParseFail,
      extractedNoSeller,
      matchedUser: matchedEvents.length,
    };

    logger.info('reencryption-history: extraction summary', { pkh, ...meta, requestId: req.requestId });

    matchedEvents.sort((a, b) => b.timestamp - a.timestamp);

    apiCache.set(cacheKey, matchedEvents, CACHE_TTL_CHAIN);
    return res.json({ data: matchedEvents, meta });
  } catch (error) {
    const detail = error instanceof Error ? `${error.message}` : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    logger.error('Failed to fetch reencryption history', { error: detail, stack, pkh, requestId: req.requestId });

    const stale = apiCache.getStale<ReencryptionEvent[]>(cacheKey);
    if (stale) {
      return res.json({ data: stale });
    }

    return res.status(503).json({
      error: {
        code: 'REENCRYPTION_HISTORY_UNAVAILABLE',
        message: 'Unable to fetch re-encryption history',
        // Surface the underlying cause to the dev console — this is local
        // dev only, no remote multi-tenant exposure here.
        detail,
        requestId: req.requestId,
      },
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
type ExtractSkipReason =
  | 'no-bid-input'
  | 'no-encryption-output'
  | 'encryption-output-no-datum'
  | 'encryption-output-no-token-name'
  | 'encryption-output-no-buyer-pkh'
  | 'parse-fail';

/** Partial event returned when the encryption output was identified but
 * its inline_datum was stripped from the /tx_info response (Koios drops
 * large datums on outputs). The caller fetches the datum via /utxo_info
 * with `_extended: true` in a batched second pass. */
interface PartialReencryptionEvent {
  txHash: string;
  blockHeight: number;
  timestamp: number;
  bidAmountLovelace: number;
  sellerPkh: string;
  encryptionOutputIndex: number;
  /** Asset name from /tx_info if available; may be empty if asset_list
   * wasn't populated, in which case the second pass can backfill it
   * from the /utxo_info response. */
  encryptionTokenNameHint: string;
}

type ExtractResult =
  | { kind: 'event'; value: ReencryptionEvent }
  | { kind: 'partial'; value: PartialReencryptionEvent }
  | { kind: 'skip'; reason: ExtractSkipReason };

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
): ExtractResult {
  if (!contracts.encryptionAddress || !contracts.biddingAddress) return { kind: 'skip', reason: 'no-bid-input' };
  if (!contracts.encryptionPolicyId || !contracts.biddingPolicyId) return { kind: 'skip', reason: 'no-bid-input' };

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
  if (!foundBidInput) return { kind: 'skip', reason: 'no-bid-input' };

  // Try several strategies to find the seller's wallet PKH. None are
  // guaranteed (some PEACE re-encryption txs evidently have no wallet
  // input cred in tx_info — likely paid via collateral / aggregator
  // pattern), so this is best-effort. A row is still emitted for the
  // buyer's tax record even when sellerPkh stays empty.
  let sellerPkh = '';
  // Strategy 1: an output paying out the bid amount to a non-contract
  // address. The seller is the only party who receives the bid lovelace
  // in the re-encryption — locating that output is far more reliable
  // than guessing from inputs.
  for (const out of tx.outputs) {
    const bech = out.payment_addr?.bech32;
    const cred = out.payment_addr?.cred;
    if (!cred) continue;
    if (bech === contracts.encryptionAddress || bech === contracts.biddingAddress) continue;
    const lovelace = parseInt(out.value || '0', 10) || 0;
    if (lovelace >= bidAmountLovelace && bidAmountLovelace > 0) {
      sellerPkh = cred;
      break;
    }
  }
  // Strategy 2 (fallback): first non-contract input cred. Only useful
  // when wallet-fee inputs are present; many PEACE txs don't have them.
  if (!sellerPkh) {
    for (const inp of tx.inputs ?? []) {
      const cred = inp.payment_addr?.cred;
      if (!cred) continue;
      if (isContractInput(inp)) continue;
      sellerPkh = cred;
      break;
    }
  }

  let buyerPkh = '';
  let encryptionTokenName = '';
  let futurePriceLovelace = 0;
  let sawEncryptionOutput = false;
  let sawDatum = false;
  let parseFailed = false;
  let encryptionOutputIndex = -1;
  let arrayIdx = -1;
  for (const out of tx.outputs) {
    arrayIdx++;
    const matchesByAddress = out.payment_addr?.bech32 === contracts.encryptionAddress;
    const matchesByPolicy = out.asset_list?.some((a) => a.policy_id === contracts.encryptionPolicyId);
    if (!matchesByAddress && !matchesByPolicy) continue;
    sawEncryptionOutput = true;
    // Prefer Koios's explicit `tx_index` field — array position can drift
    // from on-chain tx_index for txs with collateral_outputs or when Koios
    // omits some outputs. Fall back to array index only if tx_index isn't
    // populated.
    if (encryptionOutputIndex < 0) {
      encryptionOutputIndex = typeof out.tx_index === 'number' ? out.tx_index : arrayIdx;
    }
    // Backfill the token name from /tx_info's asset_list when present —
    // saves a round-trip in the second pass for rows where only the
    // datum (not the asset list) was stripped.
    if (!encryptionTokenName && out.asset_list) {
      const encAsset = out.asset_list.find((a) => a.policy_id === contracts.encryptionPolicyId);
      if (encAsset) encryptionTokenName = encAsset.asset_name;
    }
    // Koios `/tx_info` strips `inline_datum` from outputs whose datum
    // exceeds its size cap (encryption datums carry BLS12-381 G1/G2
    // points + a Capsule, well over the cap). Try `value` first, then
    // CBOR-decode `bytes`. If neither is present, the second pass
    // re-fetches via `/utxo_info` (`_extended: true`).
    let datumValue = out.inline_datum?.value;
    if (!datumValue && out.inline_datum?.bytes) {
      try {
        datumValue = decodePlutusData(out.inline_datum.bytes);
      } catch (err) {
        logger.warn('reencryption-history: inline_datum CBOR decode failed', {
          tx: tx.tx_hash,
          error: String(err),
        });
      }
    }
    if (!datumValue) continue;
    sawDatum = true;
    try {
      const datum = parseEncryptionDatum(datumValue);
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
    break;
  }

  if (buyerPkh && encryptionTokenName) {
    const epochSeconds = tx.tx_timestamp ?? tx.block_time ?? 0;
    return {
      kind: 'event',
      value: {
        txHash: tx.tx_hash,
        blockHeight: tx.block_height,
        timestamp: epochSeconds * 1000,
        encryptionTokenName,
        buyerPkh,
        sellerPkh,
        bidAmountLovelace,
        futurePriceLovelace,
      },
    };
  }

  // Encryption output exists but its datum was stripped by Koios — emit
  // a partial so the second pass can fetch the inline_datum via
  // /utxo_info. The token name may still be empty if asset_list was
  // also stripped; the second pass backfills it from utxo_info.asset_list.
  if (sawEncryptionOutput && !sawDatum && encryptionOutputIndex >= 0) {
    const epochSeconds = tx.tx_timestamp ?? tx.block_time ?? 0;
    return {
      kind: 'partial',
      value: {
        txHash: tx.tx_hash,
        blockHeight: tx.block_height,
        timestamp: epochSeconds * 1000,
        bidAmountLovelace,
        sellerPkh,
        encryptionOutputIndex,
        encryptionTokenNameHint: encryptionTokenName,
      },
    };
  }

  if (parseFailed) return { kind: 'skip', reason: 'parse-fail' };
  if (!sawEncryptionOutput) return { kind: 'skip', reason: 'no-encryption-output' };
  if (!sawDatum) return { kind: 'skip', reason: 'encryption-output-no-datum' };
  if (!buyerPkh) return { kind: 'skip', reason: 'encryption-output-no-buyer-pkh' };
  return { kind: 'skip', reason: 'encryption-output-no-token-name' };
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
