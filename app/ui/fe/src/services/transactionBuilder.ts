/**
 * Transaction Builder Service
 *
 * Builds and submits Cardano transactions for the Peace Protocol.
 * Uses MeshTxBuilder with BlockfrostProvider for real transactions.
 *
 * Configuration required (in .env):
 * - VITE_USE_STUBS=false (enable real transactions)
 * - VITE_BLOCKFROST_PROJECT_ID_PREPROD=<key> (for tx building/evaluation)
 *
 * Backend must have reference script UTxOs configured:
 * - ENCRYPTION_REF_TX_HASH_PREPROD=<hash>
 * - ENCRYPTION_REF_OUTPUT_INDEX_PREPROD=1
 */

import { MeshTxBuilder, BlockfrostProvider, deserializeAddress } from '@meshsdk/core';
import type { IWallet } from '@meshsdk/core';
import { createEncryptionWithWallet, getStubWarning, createBidArtifactsFromWallet } from './crypto';
import { storeSecrets } from './secretStorage';
import { storeBidSecrets, removeBidSecrets } from './bidSecretStorage';
import { protocolApi } from './api';
import type { CreateListingFormData } from '../components/CreateListingModal';

// Environment flag for stub mode
const USE_STUBS = import.meta.env.VITE_USE_STUBS === 'true';

/**
 * Result of a transaction submission.
 */
export interface TransactionResult {
  success: boolean;
  txHash?: string;
  tokenName?: string;
  error?: string;
  isStub?: boolean;
}

/**
 * Compute token name from a UTxO.
 * Token name = CBOR(outputIndex) + txHash (first 64 - len(cbor) chars)
 *
 * @param txHash - Transaction hash (64 hex chars)
 * @param outputIndex - Output index
 * @returns Token name (64 hex chars)
 */
function computeTokenName(txHash: string, outputIndex: number): string {
  // CBOR encode the output index
  // For small integers (0-23), CBOR is just the value
  // For 24-255, CBOR is 0x18 + value
  // For larger, use more bytes
  let indexCbor: string;
  if (outputIndex <= 23) {
    indexCbor = outputIndex.toString(16).padStart(2, '0');
  } else if (outputIndex <= 255) {
    indexCbor = '18' + outputIndex.toString(16).padStart(2, '0');
  } else {
    // 2-byte integer: 0x19 + value
    indexCbor = '19' + outputIndex.toString(16).padStart(4, '0');
  }

  // Concatenate and truncate to 64 hex chars
  const combined = indexCbor + txHash;
  return combined.slice(0, 64);
}

/**
 * Get storage layer URI from form data.
 */
function getStorageLayerUri(formData: CreateListingFormData): string {
  switch (formData.storageLayer) {
    case 'ipfs':
      return `ipfs://${formData.ipfsHash}`;
    case 'arweave':
      return `ar://${formData.arweaveId}`;
    case 'on-chain':
    default:
      return 'on-chain';
  }
}

/**
 * Get the Blockfrost provider for the current network.
 * Throws if the API key is not configured.
 */
function getBlockfrostProvider(): BlockfrostProvider {
  const apiKey = import.meta.env.VITE_BLOCKFROST_PROJECT_ID_PREPROD;
  if (!apiKey) {
    throw new Error(
      'Blockfrost API key not configured. Set VITE_BLOCKFROST_PROJECT_ID_PREPROD in fe/.env'
    );
  }
  return new BlockfrostProvider(apiKey);
}

/**
 * Extract payment key hash from a wallet address.
 */
export function extractPaymentKeyHash(address: string): string {
  const deserialized = deserializeAddress(address);
  const pkh = deserialized.pubKeyHash;
  if (!pkh) {
    throw new Error('Could not extract payment key hash from wallet address');
  }
  return pkh;
}

/**
 * Create a new encryption listing.
 *
 * Flow:
 * 1. Fetch protocol config from backend (addresses, policy IDs, ref scripts)
 * 2. Get wallet UTxOs, address, collateral
 * 3. Compute token name from first UTxO
 * 4. Generate encryption artifacts (prompts wallet signing)
 * 5. Store secrets in IndexedDB
 * 6. Build transaction with MeshTxBuilder
 * 7. Sign and submit
 *
 * @param wallet - Connected browser wallet
 * @param formData - Form data from CreateListingModal
 * @returns Transaction result
 */
export async function createListing(
  wallet: IWallet,
  formData: CreateListingFormData
): Promise<TransactionResult> {
  try {
    // STUB MODE
    if (USE_STUBS) {
      console.warn('[STUB] createListing - using stub mode');
      console.warn(getStubWarning());

      // Generate a fake UTxO for token name computation
      const fakeUtxo = {
        txHash: Array(64).fill('a').join(''),
        outputIndex: 0,
      };
      const tokenName = computeTokenName(fakeUtxo.txHash, fakeUtxo.outputIndex);

      // Create encryption artifacts using wallet signing for sk derivation
      const artifacts = await createEncryptionWithWallet(
        wallet,
        formData.secretMessage,
        tokenName,
        true // useStubs = true (for gt_to_hash)
      );

      // Store secrets (a, r) in IndexedDB
      await storeSecrets(tokenName, artifacts.a, artifacts.r);

      // Log what would be submitted
      console.log('[STUB] Would submit transaction with:');
      console.log('  Token name:', tokenName);
      console.log('  Description:', formData.description);
      console.log('  Suggested price:', formData.suggestedPrice || 'Not set');
      console.log('  Storage layer:', getStorageLayerUri(formData));

      return {
        success: true,
        txHash: `stub_${Date.now().toString(16)}_${tokenName.slice(0, 16)}`,
        tokenName,
        isStub: true,
      };
    }

    // === REAL IMPLEMENTATION ===

    // 1. Fetch protocol config from backend
    const config = await protocolApi.getConfig();
    if (!config.contracts.encryptionAddress || !config.contracts.encryptionPolicyId) {
      throw new Error(
        'Protocol config missing contract addresses. Ensure backend .env is configured.'
      );
    }
    if (!config.referenceScripts.encryption) {
      throw new Error(
        'Encryption reference script UTxO not configured. ' +
        'Set ENCRYPTION_REF_TX_HASH_PREPROD in backend .env'
      );
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

    // 4. Sort UTxOs lexicographically (txHash then outputIndex) to match
    //    the Cardano ledger's input ordering. The on-chain validator computes
    //    the token name from the first *sorted* input, not the wallet's order.
    utxos.sort((a, b) => {
      const hashCmp = a.input.txHash.localeCompare(b.input.txHash);
      if (hashCmp !== 0) return hashCmp;
      return a.input.outputIndex - b.input.outputIndex;
    });

    const firstUtxo = utxos[0];
    const tokenName = computeTokenName(
      firstUtxo.input.txHash,
      firstUtxo.input.outputIndex
    );

    // 5. Generate encryption artifacts (prompts wallet signing for sk derivation)
    const artifacts = await createEncryptionWithWallet(
      wallet,
      formData.secretMessage,
      tokenName,
      false // useStubs = false — use real WASM if available
    );

    // 6. Store secrets BEFORE submitting transaction
    await storeSecrets(tokenName, artifacts.a, artifacts.r);

    // 7. Build inline datum (EncryptionDatum)
    // Field order must match Aiken: owner_vkh, owner_g1, token, half_level, full_level, capsule, status
    const datum = {
      constructor: 0,
      fields: [
        { bytes: ownerPkh },                      // owner_vkh (28 bytes)
        artifacts.plutusJson.register,             // owner_g1: Register { generator, public_value }
        { bytes: tokenName },                      // token (32 bytes)
        artifacts.plutusJson.halfLevel,            // half_level: HalfEncryptionLevel
        artifacts.plutusJson.fullLevel,            // full_level: None (constructor 1, [])
        artifacts.plutusJson.capsule,              // capsule: Capsule { nonce, aad, ct }
        { constructor: 0, fields: [] },            // status: Open (constructor 0)
      ],
    };

    // 8. Build mint redeemer: EntryEncryptionMint(SchnorrProof, BindingProof) — constructor 0
    const mintRedeemer = {
      constructor: 0,
      fields: [
        artifacts.plutusJson.schnorr,              // SchnorrProof { z_b, g_r_b }
        artifacts.plutusJson.binding,              // BindingProof { z_a_b, z_r_b, t_1_b, t_2_b }
      ],
    };

    // 9. Build transaction with MeshTxBuilder
    const blockfrost = getBlockfrostProvider();
    const txBuilder = new MeshTxBuilder({
      fetcher: blockfrost,
      evaluator: blockfrost,
    });

    const policyId = config.contracts.encryptionPolicyId;
    const encryptionAddress = config.contracts.encryptionAddress;
    const refScript = config.referenceScripts.encryption;

    const unsignedTx = await txBuilder
      // Explicit first input (token name is derived from this UTxO)
      .txIn(
        firstUtxo.input.txHash,
        firstUtxo.input.outputIndex,
        firstUtxo.output.amount,
        firstUtxo.output.address
      )
      // Mint +1 encryption token using reference script
      .mintPlutusScriptV3()
      .mint('1', policyId, tokenName)
      .mintTxInReference(refScript.txHash, refScript.outputIndex)
      .mintRedeemerValue(mintRedeemer, 'JSON')
      // Output to encryption contract with inline datum
      .txOut(encryptionAddress, [
        { unit: 'lovelace', quantity: '5000000' },
        { unit: policyId + tokenName, quantity: '1' },
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
      // CIP-20 metadata (description, suggestedPrice, storageLayer)
      .metadataValue(674, {
        msg: [
          formData.description,
          formData.suggestedPrice || '0',
          getStorageLayerUri(formData),
        ],
      })
      // Change and UTxO selection
      .changeAddress(changeAddress)
      .selectUtxosFrom(utxos)
      .complete();

    // 10. Sign and submit
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);

    return {
      success: true,
      txHash,
      tokenName,
    };
  } catch (error) {
    console.error('Failed to create listing:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Remove an existing listing (burn the encryption token).
 *
 * Flow:
 * 1. Fetch protocol config from backend
 * 2. Get wallet UTxOs, address, collateral
 * 3. Build spend redeemer: RemoveEncryption (constructor 0, no fields)
 * 4. Build mint redeemer: LeaveEncryptionBurn (constructor 1, fields: [tokenName])
 * 5. Spend the encryption UTxO + burn -1 token via reference script
 * 6. Sign and submit
 *
 * @param wallet - Connected browser wallet
 * @param encryption - The encryption listing to remove (includes utxo, tokenName, datum)
 * @returns Transaction result
 */
export async function removeListing(
  wallet: IWallet,
  encryption: { tokenName: string; utxo: { txHash: string; outputIndex: number }; datum: { owner_vkh: string } }
): Promise<TransactionResult> {
  try {
    if (USE_STUBS) {
      console.warn('[STUB] removeListing');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return {
        success: true,
        txHash: `stub_remove_${Date.now().toString(16)}`,
        tokenName: encryption.tokenName,
        isStub: true,
      };
    }

    // 1. Fetch protocol config
    const config = await protocolApi.getConfig();
    if (!config.contracts.encryptionPolicyId) {
      throw new Error('Protocol config missing encryption policy ID.');
    }
    if (!config.referenceScripts.encryption) {
      throw new Error('Encryption reference script UTxO not configured.');
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

    const ownerPkh = encryption.datum.owner_vkh;
    const policyId = config.contracts.encryptionPolicyId;
    const refScript = config.referenceScripts.encryption;

    // 3. Build redeemers
    // Spend redeemer: RemoveEncryption (constructor 0)
    const spendRedeemer = { constructor: 0, fields: [] };

    // Mint redeemer: LeaveEncryptionBurn (constructor 1, fields: [tokenName])
    const mintRedeemer = {
      constructor: 1,
      fields: [{ bytes: encryption.tokenName }],
    };

    // 4. Build transaction
    const blockfrost = getBlockfrostProvider();
    const txBuilder = new MeshTxBuilder({
      fetcher: blockfrost,
      evaluator: blockfrost,
    });

    const unsignedTx = await txBuilder
      // Spend the encryption contract UTxO
      .spendingPlutusScriptV3()
      .txIn(
        encryption.utxo.txHash,
        encryption.utxo.outputIndex
      )
      .spendingTxInReference(refScript.txHash, refScript.outputIndex)
      .txInInlineDatumPresent()
      .txInRedeemerValue(spendRedeemer, 'JSON')
      // Burn -1 encryption token using reference script
      .mintPlutusScriptV3()
      .mint('-1', policyId, encryption.tokenName)
      .mintTxInReference(refScript.txHash, refScript.outputIndex)
      .mintRedeemerValue(mintRedeemer, 'JSON')
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
      .selectUtxosFrom(utxos)
      .complete();

    // 5. Sign and submit
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);

    return {
      success: true,
      txHash,
      tokenName: encryption.tokenName,
    };
  } catch (error) {
    console.error('Failed to remove listing:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Cancel a pending listing.
 *
 * BLOCKED: Requires Phase 12f implementation.
 */
export async function cancelPendingListing(
  _wallet: IWallet,
  _tokenName: string
): Promise<TransactionResult> {
  if (USE_STUBS) {
    console.warn('[STUB] cancelPendingListing');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return {
      success: true,
      txHash: `stub_cancel_${Date.now().toString(16)}`,
      isStub: true,
    };
  }

  throw new Error('Cancel pending is not yet implemented (Phase 12f)');
}

/**
 * Place a bid on an encryption listing.
 *
 * STUB MODE: Simulates the transaction without actually submitting.
 *
 * @param wallet - Connected browser wallet
 * @param encryptionTokenName - Token name of the encryption being bid on
 * @param bidAmountAda - Bid amount in ADA
 * @returns Transaction result
 */
export async function placeBid(
  wallet: IWallet,
  encryptionTokenName: string,
  bidAmountAda: number
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

      const bidAmountLovelace = Math.floor(bidAmountAda * 1_000_000);
      console.log('[STUB] Would submit bid transaction with:');
      console.log('  Bid token name:', bidTokenName);
      console.log('  Encryption token:', encryptionTokenName);
      console.log('  Bid amount:', bidAmountAda, 'ADA (', bidAmountLovelace, 'lovelace)');

      await new Promise((resolve) => setTimeout(resolve, 1500));

      return {
        success: true,
        txHash: `stub_bid_${Date.now().toString(16)}_${bidTokenName.slice(0, 16)}`,
        tokenName: bidTokenName,
        isStub: true,
      };
    }

    // Real implementation will be Phase 12c
    throw new Error('Real bid submission is not yet implemented (Phase 12c)');
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
 * @param wallet - Connected browser wallet
 * @param bidTokenName - Token name of the bid to cancel
 * @returns Transaction result
 */
export async function cancelBid(
  _wallet: IWallet,
  bidTokenName: string
): Promise<TransactionResult> {
  if (USE_STUBS) {
    console.warn('[STUB] cancelBid');
    await new Promise((resolve) => setTimeout(resolve, 1500));

    try {
      await removeBidSecrets(bidTokenName);
      console.log('[STUB] Removed bid secrets for:', bidTokenName);
    } catch (error) {
      console.warn('[STUB] Failed to remove bid secrets:', error);
    }

    return {
      success: true,
      txHash: `stub_cancel_bid_${Date.now().toString(16)}`,
      isStub: true,
    };
  }

  throw new Error('Cancel bid is not yet implemented (Phase 12d)');
}

/**
 * Check if real transactions are available.
 */
export function isRealTransactionsAvailable(): boolean {
  return !USE_STUBS;
}

/**
 * Get warning message about stub mode.
 */
export function getTransactionStubWarning(): string {
  if (USE_STUBS) {
    return (
      'Transaction submission is in STUB mode. No real transactions will be submitted. ' +
      'Set VITE_USE_STUBS=false and configure Blockfrost API key to enable real transactions.'
    );
  }
  return '';
}
