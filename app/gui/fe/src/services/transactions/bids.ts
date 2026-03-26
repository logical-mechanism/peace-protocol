/**
 * Bidding Lifecycle Transactions
 *
 * Place and cancel bids on encryption listings.
 */

import type { IWallet } from '@meshsdk/core';
import { createBidArtifactsFromWallet, getStubWarning } from '../crypto';
import { storeBidSecrets, removeBidSecrets } from '../bidSecretStorage';
import { protocolApi } from '../api';
import { buildBidMetadata } from '../metadata';
import { getChainingAdapter, getPendingTxPool } from '../providers';

import {
  USE_STUBS,
  type TransactionResult,
  excludeUtxos,
  withTimeout,
  computeTokenName,
  extractPaymentKeyHash,
  createTxBuilder,
  fetchCurrentSlot,
} from './txUtils';

/**
 * Place a bid on an encryption listing.
 *
 * Flow:
 * 1. Fetch protocol config from backend (addresses, policy IDs, ref scripts)
 * 2. Get wallet UTxOs, address, collateral
 * 3. Compute bid token name from first UTxO
 * 4. Generate bid artifacts (register, schnorr proof — prompts wallet signing)
 * 5. Store bidder secret in IndexedDB
 * 6. Build transaction with MeshTxBuilder
 * 7. Sign and submit
 *
 * @param wallet - Connected browser wallet
 * @param encryptionTokenName - Token name of the encryption being bid on
 * @param bidAmountAda - Bid amount in ADA
 * @param encryptionUtxo - The encryption UTxO (for read-only reference)
 * @returns Transaction result
 */
export async function placeBid(
  wallet: IWallet,
  encryptionTokenName: string,
  bidAmountAda: number,
  encryptionUtxo: { txHash: string; outputIndex: number },
  metadata?: { futurePrice?: number },
  onSubmitted?: (txHash: string, tokenName?: string) => void,
): Promise<TransactionResult> {
  try {
    // STUB MODE
    if (USE_STUBS) {
      console.warn('[STUB] placeBid - using stub mode');
      console.warn(getStubWarning());

      const fakeUtxo = {
        txHash: Array(64)
          .fill(0)
          .map(() => Math.floor(Math.random() * 16).toString(16))
          .join(''),
        outputIndex: 0,
      };
      const bidTokenName = computeTokenName(fakeUtxo.txHash, fakeUtxo.outputIndex);

      const artifacts = await createBidArtifactsFromWallet(wallet);
      await storeBidSecrets(bidTokenName, encryptionTokenName, artifacts.b);

      await new Promise((resolve) => setTimeout(resolve, 1500));

      return {
        success: true,
        txHash: `stub_bid_${Date.now().toString(16)}_${bidTokenName.slice(0, 16)}`,
        tokenName: bidTokenName,
        isStub: true,
      };
    }

    // === REAL IMPLEMENTATION ===

    // 1. Fetch protocol config from backend
    const config = await protocolApi.getConfig();
    if (!config.contracts.biddingAddress || !config.contracts.biddingPolicyId) {
      throw new Error(
        'Protocol config missing bidding contract addresses. Ensure backend .env is configured.'
      );
    }
    if (!config.referenceScripts.bidding) {
      throw new Error(
        'Bidding reference script UTxO not configured. ' +
        'Set BIDDING_REF_TX_HASH_PREPROD in backend .env'
      );
    }
    if (!config.genesisToken) {
      throw new Error('Genesis token not configured in protocol config.');
    }

    // 2. Get wallet info
    const utxos = await wallet.getUtxos();
    if (utxos.length === 0) {
      throw new Error('No UTxOs found in wallet. Fund your wallet with preprod ADA first.');
    }

    const usedAddresses = await wallet.getUsedAddresses();
    if (usedAddresses.length === 0) {
      throw new Error('No used addresses found in wallet.');
    }
    const changeAddress = await wallet.getChangeAddress();

    const collateral = await wallet.getCollateral();
    if (!collateral || collateral.length === 0) {
      throw new Error(
        'No collateral set in wallet. Set collateral in your wallet settings ' +
        '(Eternl: Settings > Collateral).'
      );
    }

    // 3. Extract payment key hash
    const ownerPkh = extractPaymentKeyHash(usedAddresses[0]);

    // 4. Sort UTxOs lexicographically to match on-chain token name derivation
    utxos.sort((a, b) => {
      const hashCmp = a.input.txHash.localeCompare(b.input.txHash);
      if (hashCmp !== 0) return hashCmp;
      return a.input.outputIndex - b.input.outputIndex;
    });

    // Pick the first UTxO that isn't the collateral to avoid consuming it as a regular input.
    const nonCollateral = excludeUtxos(utxos, collateral[0]);
    if (nonCollateral.length === 0) {
      throw new Error('No non-collateral UTxOs available. Send more ADA to your wallet.');
    }
    const firstUtxo = nonCollateral[0];
    const bidTokenName = computeTokenName(
      firstUtxo.input.txHash,
      firstUtxo.input.outputIndex
    );

    // 5. Generate bid artifacts (prompts wallet signing for sk derivation)
    const artifacts = await createBidArtifactsFromWallet(wallet);

    // 6. Store bidder secret BEFORE submitting transaction
    await storeBidSecrets(bidTokenName, encryptionTokenName, artifacts.b);

    // 7. Find the genesis token UTxO for read-only reference
    const fetcher = getChainingAdapter();
    const referenceUtxos = await fetcher.fetchAddressUTxOs(
      config.contracts.referenceAddress
    );
    const genesisUnit = config.genesisToken.policyId + config.genesisToken.tokenName;
    const genesisUtxo = referenceUtxos.find(u =>
      u.output.amount.some(a => a.unit === genesisUnit && parseInt(a.quantity) >= 1)
    );
    if (!genesisUtxo) {
      throw new Error(
        'Genesis token UTxO not found at reference contract address. ' +
        'Ensure the genesis token is deployed.'
      );
    }

    // 8. Build inline datum (BidDatum)
    // Field order must match Aiken: owner_vkh, owner_g1, pointer, token, locked_until
    // pointer = bid token name (validated == token_name on-chain)
    // token = encryption token name (the one being bid on)
    // locked_until = 2 * minimum_bid_lock (12 hours) from now
    const MINIMUM_BID_LOCK_MS = 6 * 60 * 60 * 1000; // 6 hours, matches on-chain constant
    const lockedUntil = Date.now() + 2 * MINIMUM_BID_LOCK_MS;
    const datum = {
      constructor: 0,
      fields: [
        { bytes: ownerPkh },                    // owner_vkh (28 bytes)
        artifacts.plutusJson.register,           // owner_g1: Register { generator, public_value }
        { bytes: bidTokenName },                 // pointer (bid token name)
        { bytes: encryptionTokenName },          // token (encryption token name)
        { int: lockedUntil },                    // locked_until (POSIX ms)
        { int: Math.floor((metadata?.futurePrice ?? 0) * 1_000_000) }, // new_price (lovelace)
      ],
    };

    // 9. Build mint redeemer: EntryBidMint(SchnorrProof) — constructor 0
    const mintRedeemer = {
      constructor: 0,
      fields: [
        artifacts.plutusJson.schnorr,            // SchnorrProof { z_b, g_r_b }
      ],
    };

    // 10. Build transaction with MeshTxBuilder
    const biddingPolicyId = config.contracts.biddingPolicyId;
    const biddingAddress = config.contracts.biddingAddress;
    const refScript = config.referenceScripts.bidding;

    // Bid amount in lovelace (the ADA locked at the script IS the bid)
    const bidAmountLovelace = Math.floor(bidAmountAda * 1_000_000).toString();

    // 10a. Compute validity interval (contract requires finite upper bound for lock check)
    const currentSlot = await fetchCurrentSlot();
    const invalidBefore = currentSlot - 60;     // ~1 minute ago
    const invalidHereafter = currentSlot + 900; // ~15 minutes from now

    const txBuilder = createTxBuilder();

    const unsignedTx = await withTimeout(
      txBuilder
        // Explicit first input (bid token name is derived from this UTxO)
        .txIn(
          firstUtxo.input.txHash,
          firstUtxo.input.outputIndex,
          firstUtxo.output.amount,
          firstUtxo.output.address
        )
        // Read-only reference: genesis token UTxO (provides ReferenceDatum)
        .readOnlyTxInReference(
          genesisUtxo.input.txHash,
          genesisUtxo.input.outputIndex
        )
        // Read-only reference: encryption UTxO (validates encryption exists)
        .readOnlyTxInReference(
          encryptionUtxo.txHash,
          encryptionUtxo.outputIndex
        )
        // Mint +1 bid token using reference script
        .mintPlutusScriptV3()
        .mint('1', biddingPolicyId, bidTokenName)
        .mintTxInReference(refScript.txHash, refScript.outputIndex)
        .mintRedeemerValue(mintRedeemer, 'JSON')
        // Output to bidding contract with inline datum
        // The lovelace locked here IS the bid amount
        .txOut(biddingAddress, [
          { unit: 'lovelace', quantity: bidAmountLovelace },
          { unit: biddingPolicyId + bidTokenName, quantity: '1' },
        ])
        .txOutInlineDatumValue(datum, 'JSON')
        // Collateral for script execution
        .txInCollateral(
          collateral[0].input.txHash,
          collateral[0].input.outputIndex,
          collateral[0].output.amount,
          collateral[0].output.address
        )
        // Required signer (validator checks owner_vkh is a signer)
        .requiredSignerHash(ownerPkh)
        // CIP-20 metadata: only the bidder's desired future listing price
        // Description and storageLayer are the seller's data — carried forward
        // in Phase 12e/12f from the encryption UTxO, not from the bid.
        .metadataValue(674, buildBidMetadata(''))
        // Validity interval (on-chain lock check needs finite upper bound)
        .invalidBefore(invalidBefore)
        .invalidHereafter(invalidHereafter)
        // Change and UTxO selection
        // Exclude firstUtxo (explicit input) and collateral from coin selection.
        .changeAddress(changeAddress)
        .selectUtxosFrom(excludeUtxos(utxos, firstUtxo, collateral[0]))
        .complete(),
      180_000,
      'placeBid tx build',
    );

    // 11. Sign and submit
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);
    await getPendingTxPool().registerTx(signedTx, txHash);
    try { onSubmitted?.(txHash, bidTokenName); } catch { /* don't break tx flow */ }

    return {
      success: true,
      txHash,
      tokenName: bidTokenName,
    };
  } catch (error) {
    console.error('Failed to place bid:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Cancel (remove) a bid.
 *
 * Flow:
 * 1. Fetch protocol config from backend
 * 2. Get wallet UTxOs, address, collateral
 * 3. Build spend redeemer: RemoveBid (constructor 0)
 * 4. Build mint redeemer: LeaveBidBurn (constructor 1, fields: [tokenName])
 * 5. Spend the bid UTxO + burn -1 bid token via reference script
 * 6. Sign and submit
 * 7. Remove bid secrets from IndexedDB
 *
 * @param wallet - Connected browser wallet
 * @param bid - The bid to cancel (includes tokenName, utxo, datum)
 * @returns Transaction result
 */
export async function cancelBid(
  wallet: IWallet,
  bid: { tokenName: string; utxo: { txHash: string; outputIndex: number }; datum: { owner_vkh: string; locked_until: number } },
  onSubmitted?: (txHash: string, tokenName?: string) => void,
): Promise<TransactionResult> {
  try {
    if (USE_STUBS) {
      console.warn('[STUB] cancelBid');
      await new Promise((resolve) => setTimeout(resolve, 1500));

      try {
        await removeBidSecrets(bid.tokenName);
      } catch (error) {
        console.warn('[STUB] Failed to remove bid secrets:', error);
      }

      return {
        success: true,
        txHash: `stub_cancel_bid_${Date.now().toString(16)}`,
        isStub: true,
      };
    }

    // === REAL IMPLEMENTATION ===

    // 1. Fetch protocol config
    const config = await protocolApi.getConfig();
    if (!config.contracts.biddingPolicyId) {
      throw new Error('Protocol config missing bidding policy ID.');
    }
    if (!config.referenceScripts.bidding) {
      throw new Error('Bidding reference script UTxO not configured.');
    }

    // 2. Get wallet info
    const utxos = await wallet.getUtxos();
    if (utxos.length === 0) {
      throw new Error('No UTxOs found in wallet.');
    }

    const changeAddress = await wallet.getChangeAddress();
    const collateral = await wallet.getCollateral();
    if (!collateral || collateral.length === 0) {
      throw new Error('No collateral set in wallet.');
    }

    const ownerPkh = bid.datum.owner_vkh;
    const policyId = config.contracts.biddingPolicyId;
    const refScript = config.referenceScripts.bidding;

    // 3. Check bid lock has expired
    if (bid.datum.locked_until > Date.now()) {
      const unlockDate = new Date(bid.datum.locked_until).toLocaleString();
      throw new Error(`Bid is locked until ${unlockDate}. You cannot cancel it before then.`);
    }

    // 4. Build redeemers
    // Spend redeemer: RemoveBid (constructor 0)
    const spendRedeemer = { constructor: 0, fields: [] };

    // Mint redeemer: LeaveBidBurn (constructor 1, fields: [tokenName])
    const mintRedeemer = {
      constructor: 1,
      fields: [{ bytes: bid.tokenName }],
    };

    // 5. Set validity interval so on-chain lb > locked_until check passes
    const currentSlot = await fetchCurrentSlot();
    const invalidBeforeSlot = currentSlot - 60; // ~1 minute ago (ensures node accepts it)
    const invalidHereafterSlot = currentSlot + 900; // ~15 minutes from now

    // 6. Build transaction
    const txBuilder = createTxBuilder();

    const unsignedTx = await withTimeout(
      txBuilder
        // Spend the bid contract UTxO
        .spendingPlutusScriptV3()
        .txIn(
          bid.utxo.txHash,
          bid.utxo.outputIndex
        )
        .spendingTxInReference(refScript.txHash, refScript.outputIndex)
        .txInInlineDatumPresent()
        .txInRedeemerValue(spendRedeemer, 'JSON')
        // Burn -1 bid token using reference script
        .mintPlutusScriptV3()
        .mint('-1', policyId, bid.tokenName)
        .mintTxInReference(refScript.txHash, refScript.outputIndex)
        .mintRedeemerValue(mintRedeemer, 'JSON')
        // Validity interval: lower bound must be past locked_until
        .invalidBefore(invalidBeforeSlot)
        .invalidHereafter(invalidHereafterSlot)
        // Collateral
        .txInCollateral(
          collateral[0].input.txHash,
          collateral[0].input.outputIndex,
          collateral[0].output.amount,
          collateral[0].output.address
        )
        // Required signer (owner must sign)
        .requiredSignerHash(ownerPkh)
        // Change and UTxO selection
        .changeAddress(changeAddress)
        .selectUtxosFrom(excludeUtxos(utxos, collateral[0]))
        .complete(),
      180_000,
      'cancelBid tx build',
    );

    // 5. Sign and submit
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);
    await getPendingTxPool().registerTx(signedTx, txHash);
    try { onSubmitted?.(txHash, bid.tokenName); } catch { /* don't break tx flow */ }

    // 6. Clean up bid secrets from IndexedDB
    try {
      await removeBidSecrets(bid.tokenName);
    } catch (error) {
      console.warn('Failed to remove bid secrets after cancel:', error);
    }

    return {
      success: true,
      txHash,
      tokenName: bid.tokenName,
    };
  } catch (error) {
    console.error('Failed to cancel bid:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
