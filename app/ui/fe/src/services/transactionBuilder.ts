/**
 * Transaction Builder Service
 *
 * Builds and submits Cardano transactions for the Peace Protocol.
 *
 * BLOCKED UNTIL CONTRACT DEPLOYMENT:
 * - Contract addresses not available on preprod
 * - Reference script UTxOs not deployed
 * - Genesis token policy not available
 *
 * This service provides stub implementations for UI development.
 * When contracts are deployed, update:
 * 1. Contract addresses in environment variables
 * 2. Reference script UTxO queries
 * 3. Token minting logic
 */

import type { IWallet } from '@meshsdk/core';
import { createEncryptionWithWallet, getStubWarning } from './crypto';
import { storeSecrets } from './secretStorage';
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
 * Create a new encryption listing.
 *
 * STUB MODE: Simulates the transaction without actually submitting.
 *
 * Real flow (when contracts deployed):
 * 1. Get UTxO from wallet to compute token name
 * 2. Generate encryption artifacts
 * 3. Store secrets in IndexedDB
 * 4. Build transaction with MeshJS
 * 5. Sign and submit transaction
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
      console.warn('[STUB] createListing - contracts not deployed');
      console.warn(getStubWarning());

      // Generate a fake UTxO for token name computation
      const fakeUtxo = {
        txHash: Array(64).fill('a').join(''),
        outputIndex: 0,
      };
      const tokenName = computeTokenName(fakeUtxo.txHash, fakeUtxo.outputIndex);

      // Create encryption artifacts using wallet signing for sk derivation
      // This will prompt the user to sign a message in their wallet
      const artifacts = await createEncryptionWithWallet(
        wallet,
        formData.secretMessage,
        tokenName,
        true // useStubs = true (for gt_to_hash)
      );

      // Store secrets (a, r) in IndexedDB
      // sk is derived from wallet signature and doesn't need storage
      await storeSecrets(tokenName, artifacts.a, artifacts.r);

      // Log what would be submitted
      console.log('[STUB] Would submit transaction with:');
      console.log('  Token name:', tokenName);
      console.log('  Description:', formData.description);
      console.log('  Suggested price:', formData.suggestedPrice || 'Not set');
      console.log('  Storage layer:', getStorageLayerUri(formData));
      console.log('  Register:', artifacts.plutusJson.register);
      console.log('  Schnorr proof:', artifacts.plutusJson.schnorr);
      console.log('  Half level:', artifacts.plutusJson.halfLevel);
      console.log('  Capsule:', artifacts.plutusJson.capsule);

      // Return stub result
      return {
        success: true,
        txHash: `stub_${Date.now().toString(16)}_${tokenName.slice(0, 16)}`,
        tokenName,
        isStub: true,
      };
    }

    // REAL IMPLEMENTATION (blocked until contract deployment)
    throw new Error(
      'Real transaction submission is blocked until contracts are deployed to preprod. ' +
        'Set VITE_USE_STUBS=true for development.'
    );

    // TODO: When contracts are deployed, implement:
    //
    // 1. Get UTxOs from wallet
    // const utxos = await wallet.getUtxos();
    // const selectedUtxo = utxos[0];
    // const tokenName = computeTokenName(selectedUtxo.txHash, selectedUtxo.outputIndex);
    //
    // 2. Get wallet address and derive secret
    // const usedAddresses = await wallet.getUsedAddresses();
    // const address = usedAddresses[0];
    // const signature = await wallet.signData(address, 'peace-protocol-key-derivation');
    // const walletSecretHex = signature.key.slice(0, 64); // Or derive properly
    //
    // 3. Create encryption artifacts (with real gt_to_hash when available)
    // const artifacts = await createEncryptionArtifacts(
    //   walletSecretHex,
    //   formData.secretMessage,
    //   tokenName,
    //   false // useStubs = false for real
    // );
    //
    // 4. Store secrets BEFORE submitting transaction
    // await storeSecrets(tokenName, artifacts.a, artifacts.r);
    //
    // 5. Build transaction using MeshJS
    // import { Transaction, resolveScriptHash } from '@meshsdk/core';
    // const tx = new Transaction({ initiator: wallet });
    // tx.setMetadata(674, {
    //   msg: [formData.description, formData.suggestedPrice || '0', getStorageLayerUri(formData)]
    // });
    // // ... mint token, send to contract, etc.
    //
    // 6. Sign and submit
    // const unsignedTx = await tx.build();
    // const signedTx = await wallet.signTx(unsignedTx);
    // const txHash = await wallet.submitTx(signedTx);
    //
    // return { success: true, txHash, tokenName };
  } catch (error) {
    console.error('Failed to create listing:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Remove an existing listing.
 *
 * BLOCKED: Requires contract deployment.
 */
export async function removeListing(
  _wallet: IWallet,
  _tokenName: string
): Promise<TransactionResult> {
  if (USE_STUBS) {
    console.warn('[STUB] removeListing - contracts not deployed');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return {
      success: true,
      txHash: `stub_remove_${Date.now().toString(16)}`,
      isStub: true,
    };
  }

  throw new Error('Remove listing is blocked until contracts are deployed');
}

/**
 * Cancel a pending listing.
 *
 * BLOCKED: Requires contract deployment.
 */
export async function cancelPendingListing(
  _wallet: IWallet,
  _tokenName: string
): Promise<TransactionResult> {
  if (USE_STUBS) {
    console.warn('[STUB] cancelPendingListing - contracts not deployed');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return {
      success: true,
      txHash: `stub_cancel_${Date.now().toString(16)}`,
      isStub: true,
    };
  }

  throw new Error('Cancel pending is blocked until contracts are deployed');
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
      'This is for UI development while contracts are not deployed to preprod.'
    );
  }
  return '';
}
