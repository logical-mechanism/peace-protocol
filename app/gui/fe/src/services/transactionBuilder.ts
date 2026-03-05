/**
 * Transaction Builder Service
 *
 * Builds and submits Cardano transactions for the Peace Protocol.
 * Uses MeshTxBuilder with local Kupo (fetcher) and Ogmios (evaluator).
 *
 * Configuration required (in .env):
 * - VITE_USE_STUBS=false (enable real transactions)
 *
 * Backend must have reference script UTxOs configured:
 * - ENCRYPTION_REF_TX_HASH_PREPROD=<hash>
 * - ENCRYPTION_REF_OUTPUT_INDEX_PREPROD=1
 */

import { MeshTxBuilder, deserializeAddress } from '@meshsdk/core';
import type { IWallet } from '@meshsdk/core';
import { getKupoAdapter, getOgmiosProvider } from './providers';
import { createEncryptionWithWallet, getStubWarning, createBidArtifactsFromWallet } from './crypto';
import {
  rng, g1Point, g2Point, scale, combine, invertG2, toInt, generate,
  H0, H1, H2, H2I_DOMAIN_TAG,
  createPublicRegister, registerToPlutusJson,
  bindingProof, bindingToPlutusJson,
  halfLevelToPlutusJson, fullLevelToPlutusJson,
} from './crypto';
import { storeSecrets } from './secretStorage';
import { storeBidSecrets, removeBidSecrets } from './bidSecretStorage';
import { storeAcceptBidSecrets, getAcceptBidSecrets } from './acceptBidStorage';
import { deriveSecretFromWallet } from './crypto/walletSecret';
import { bech32 } from '@scure/base';
import { buildPayload } from './crypto/payload';
import { protocolApi } from './api';
import type { EncryptionDisplay, BidDisplay } from './api';
import { getSnarkProver, type SnarkProof } from './snark';
import type { CreateListingFormData } from '../components/CreateListingModal';
import { buildEncryptionMetadata, buildBidMetadata } from './metadata';
import { encryptFileForUpload, encodeFileSecret } from './crypto/fileEncryption';
import { uploadFile as iagonUpload, listFiles as iagonListFiles } from './iagonApi';
import { getStoredApiKey } from './iagonAuth';
import { hexToBytes, bytesToHex } from './crypto/bls12381';
import {
  createListingDraft,
  updateListingDraft,
  type ListingDraft,
} from './listingDraftStorage';

// Environment flag for stub mode
const USE_STUBS = import.meta.env.VITE_USE_STUBS === 'true';

// Cardano protocol parameter (preprod/mainnet)
const COINS_PER_UTXO_BYTE = 4310;

/**
 * Estimate the minimum lovelace for a UTxO with an inline Plutus JSON datum.
 *
 * The bash scripts use `cardano-cli calculate-min-required-utxo` which is
 * unavailable in the browser. This approximates the CBOR-serialized output
 * size from the Plutus JSON datum and applies the coinsPerUTxOByte formula.
 *
 * @param datum - Plutus JSON datum object
 * @returns Lovelace amount as a string (with 20% safety margin, min 2 ADA)
 */
export function estimateMinLovelace(datum: object): string {
  const json = JSON.stringify(datum, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );

  // Count raw byte content from hex "bytes" fields (2 hex chars = 1 CBOR byte)
  let datumBytes = 0;
  const hexRe = /"bytes"\s*:\s*"([0-9a-fA-F]*)"/g;
  let m;
  while ((m = hexRe.exec(json)) !== null) {
    datumBytes += m[1].length / 2; // hex → bytes
    datumBytes += 3; // CBOR bytestring header
  }

  // Count constructors and integer fields (small CBOR overhead each)
  const constructors = (json.match(/"constructor"\s*:/g) || []).length;
  const ints = (json.match(/"int"\s*:/g) || []).length;
  const arrays = (json.match(/"fields"\s*:/g) || []).length;
  datumBytes += constructors * 4 + ints * 3 + arrays * 2;

  // UTxO envelope: base overhead (160) + address (~60) + one native asset (~56)
  const utxoBytes = datumBytes + 276;

  const minLovelace = utxoBytes * COINS_PER_UTXO_BYTE;
  // 20% safety margin, floor of 2 ADA
  return Math.max(2_000_000, Math.ceil(minLovelace * 1.2)).toString();
}

// ── Listing creation step tracking ──────────────────────────────────────

/** Steps during listing creation, used for progress UI. */
export type ListingCreationStep =
  | 'encrypting'
  | 'uploading'
  | 'verifying'
  | 'building'
  | 'signing'
  | 'submitting';

/**
 * Build a peace-payload from saved draft fields (hex strings) instead of a File object.
 * Used for retries where the Iagon file is already uploaded.
 */
function buildPayloadFromDraftFields(
  iagonFileId: string,
  fileKeyHex: string,
  fileNonceHex: string,
  fileDigestHex: string,
  fileExtension?: string,
): Uint8Array {
  const locator = new TextEncoder().encode(iagonFileId);
  const secret = encodeFileSecret(hexToBytes(fileKeyHex), hexToBytes(fileNonceHex));
  const digest = hexToBytes(fileDigestHex);
  let extra: Map<number, Uint8Array> | undefined;
  if (fileExtension) {
    extra = new Map();
    extra.set(3, new TextEncoder().encode(fileExtension));
  }
  return buildPayload({ locator, secret, digest, extra });
}

/**
 * Verify a file exists on Iagon by listing the user's directory and matching by _id.
 * Retries up to `maxAttempts` with `delayMs` between attempts.
 */
async function verifyIagonUpload(
  apiKey: string,
  fileId: string,
  maxAttempts = 3,
  delayMs = 2000
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const files = await iagonListFiles(apiKey);
      if (files.some((f) => f._id === fileId)) {
        return true;
      }
    } catch (err) {
      console.warn(`[verifyIagonUpload] List attempt ${attempt} failed:`, err);
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  console.warn(`[verifyIagonUpload] File _id "${fileId}" not found after ${maxAttempts} attempts`);
  return false;
}

/**
 * Result of a transaction submission.
 */
export interface TransactionResult {
  success: boolean;
  txHash?: string;
  tokenName?: string;
  error?: string;
  /** Draft ID for file listings — used for retry/recovery. */
  draftId?: string;
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
export function computeTokenName(txHash: string, outputIndex: number): string {
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
 * Text category uses on-chain storage; other categories use Iagon.
 */
export function getStorageLayerUri(formData: CreateListingFormData): string {
  if (formData.category === 'text') {
    return 'on-chain';
  }
  return 'iagon';
}

/**
 * Build a canonical CBOR peace-payload from form data.
 *
 * - Text category: locator = secretMessage as UTF-8 bytes (on-chain)
 * - Other categories: locator = Iagon file ID (set by buildPayloadForIagon)
 */
function buildPayloadFromForm(formData: CreateListingFormData): Uint8Array {
  const locator = new TextEncoder().encode(formData.secretMessage);
  return buildPayload({ locator });
}

/**
 * Encrypt a file and upload it to Iagon, returning a peace-payload with:
 *   - locator (field 0): Iagon file ID
 *   - secret  (field 1): AES-256-GCM key + nonce (44 bytes)
 *   - digest  (field 2): SHA-256 of original file
 *
 * @param file - The File object from the form
 * @param tokenName - Token name for the listing (used as Iagon filename)
 * @returns CBOR-encoded peace-payload bytes
 */
async function buildPayloadForIagon(file: File, tokenName: string): Promise<Uint8Array> {
  // Read file bytes
  const fileBytes = new Uint8Array(await file.arrayBuffer());

  // Encrypt for off-chain storage
  const { encryptedBlob, key, nonce, digest } = await encryptFileForUpload(fileBytes);

  // Upload encrypted blob to Iagon
  const apiKey = await getStoredApiKey();
  if (!apiKey) {
    throw new Error('Iagon is not connected. Go to Settings > Data Layer to connect.');
  }

  // Use token name + original extension as the Iagon filename
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const iagonFilename = `${tokenName}${ext}.enc`;

  const fileInfo = await iagonUpload(
    apiKey,
    encryptedBlob,
    iagonFilename
  );

  // Build peace-payload with Iagon reference
  const locator = new TextEncoder().encode(fileInfo._id);
  const secret = encodeFileSecret(key, nonce);

  // Store original file extension as field 3 (filetype) so decryptors know the format
  let extra: Map<number, Uint8Array> | undefined;
  if (ext) {
    extra = new Map();
    extra.set(3, new TextEncoder().encode(ext));
  }

  return buildPayload({ locator, secret, digest, extra });
}

/** Create a MeshTxBuilder wired to local Kupo + Ogmios. */
function createTxBuilder(): MeshTxBuilder {
  const txBuilder = new MeshTxBuilder({
    fetcher: getKupoAdapter(),
    evaluator: getOgmiosProvider(),
  });
  txBuilder.txEvaluationMultiplier = 1.0;
  return txBuilder;
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
 * For text listings, the flow is simple (no file upload, no draft).
 * For file listings, uses a persistent draft to track the multi-step
 * process so that the expensive Iagon upload is never repeated on retry.
 *
 * Flow (file listings):
 * 1. Create draft → encrypt file → upload to Iagon → verify upload
 * 2. Fetch config, wallet info, compute token name
 * 3. Build payload from draft fields → generate encryption artifacts
 * 4. Store secrets → build tx → sign → submit
 *
 * @param wallet - Connected browser wallet
 * @param formData - Form data from CreateListingModal
 * @param onProgress - Optional callback for progress UI updates
 * @returns Transaction result (includes draftId for file listings)
 */
export async function createListing(
  wallet: IWallet,
  formData: CreateListingFormData,
  onProgress?: (step: ListingCreationStep) => void,
): Promise<TransactionResult> {
  let draftId: string | undefined;

  try {
    // STUB MODE
    if (USE_STUBS) {
      console.warn('[STUB] createListing - using stub mode');
      console.warn(getStubWarning());

      const fakeUtxo = {
        txHash: Array(64).fill('a').join(''),
        outputIndex: 0,
      };
      const tokenName = computeTokenName(fakeUtxo.txHash, fakeUtxo.outputIndex);

      const payloadBytes = formData.category === 'text'
        ? buildPayloadFromForm(formData)
        : await buildPayloadForIagon(formData.file!, tokenName);
      const artifacts = await createEncryptionWithWallet(
        wallet,
        payloadBytes,
        tokenName,
        true
      );

      await storeSecrets(tokenName, artifacts.a, artifacts.r);

      return {
        success: true,
        txHash: `stub_${Date.now().toString(16)}_${tokenName.slice(0, 16)}`,
        tokenName,
        isStub: true,
      };
    }

    // === REAL IMPLEMENTATION ===

    // ── Step 1: File encryption & upload (file listings only) ───────

    let payloadBuilder: () => Uint8Array;

    if (formData.category === 'text') {
      // Text listings: no upload, no draft
      payloadBuilder = () => buildPayloadFromForm(formData);
    } else {
      // File listings: encrypt → upload → verify with draft persistence
      draftId = crypto.randomUUID();

      onProgress?.('encrypting');
      await createListingDraft(
        draftId,
        formData.category,
        formData.description,
        formData.suggestedPrice || '0',
        formData.imageLink || '',
        formData.file!.name,
        formData.file!.size,
      );

      // Extract original file extension for payload field 3 (filetype)
      const ext = formData.file!.name.includes('.')
        ? formData.file!.name.slice(formData.file!.name.lastIndexOf('.'))
        : '';

      // Encrypt file
      const fileBytes = new Uint8Array(await formData.file!.arrayBuffer());
      const { encryptedBlob, key, nonce, digest } = await encryptFileForUpload(fileBytes);

      // Save encryption keys + file extension to draft before upload
      const fileKeyHex = bytesToHex(key);
      const fileNonceHex = bytesToHex(nonce);
      const fileDigestHex = bytesToHex(digest);
      await updateListingDraft(draftId, {
        fileKey: fileKeyHex,
        fileNonce: fileNonceHex,
        fileDigest: fileDigestHex,
        fileExtension: ext || undefined,
      });

      // Upload to Iagon
      onProgress?.('uploading');
      const apiKey = await getStoredApiKey();
      if (!apiKey) {
        throw new Error('Iagon is not connected. Go to Settings > Data Layer to connect.');
      }
      // Use draft ID for filename since token name isn't known yet
      const iagonFilename = `${draftId}${ext}.enc`;

      const fileInfo = await iagonUpload(apiKey, encryptedBlob, iagonFilename);

      await updateListingDraft(draftId, {
        status: 'uploaded',
        iagonFileId: fileInfo._id,
        iagonFilename: iagonFilename,
      });

      // Verify the upload is accessible
      onProgress?.('verifying');
      const verified = await verifyIagonUpload(apiKey, fileInfo._id);
      if (!verified) {
        await updateListingDraft(draftId, {
          status: 'failed',
          lastError: 'Upload verification failed: file not found on Iagon after upload.',
        });
        throw new Error(
          'Upload verification failed: file not found on Iagon after upload. ' +
          'The file may still be propagating. You can retry from the History tab.'
        );
      }

      await updateListingDraft(draftId, { status: 'verified' });

      // Capture draft fields for payload builder
      const savedFileId = fileInfo._id;
      payloadBuilder = () =>
        buildPayloadFromDraftFields(savedFileId, fileKeyHex, fileNonceHex, fileDigestHex, ext);
    }

    // ── Step 2: Fetch config & wallet info ──────────────────────────

    onProgress?.('building');

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

    // ── Step 3: Compute token name & build payload ──────────────────

    const ownerPkh = extractPaymentKeyHash(usedAddresses[0]);

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

    const payloadBytes = payloadBuilder();
    const artifacts = await createEncryptionWithWallet(
      wallet,
      payloadBytes,
      tokenName,
      false
    );

    // Store secrets BEFORE submitting transaction
    await storeSecrets(tokenName, artifacts.a, artifacts.r);

    if (draftId) {
      await updateListingDraft(draftId, { tokenName, status: 'signing' });
    }

    // ── Step 4: Build, sign, submit ─────────────────────────────────

    const datum = {
      constructor: 0,
      fields: [
        { bytes: ownerPkh },
        artifacts.plutusJson.register,
        { bytes: tokenName },
        artifacts.plutusJson.halfLevel,
        artifacts.plutusJson.fullLevel,
        artifacts.plutusJson.capsule,
        { constructor: 0, fields: [] },
      ],
    };

    const mintRedeemer = {
      constructor: 0,
      fields: [
        artifacts.plutusJson.schnorr,
        artifacts.plutusJson.binding,
      ],
    };

    const txBuilder = createTxBuilder();
    const policyId = config.contracts.encryptionPolicyId;
    const encryptionAddress = config.contracts.encryptionAddress;
    const refScript = config.referenceScripts.encryption;

    const unsignedTx = await txBuilder
      .txIn(
        firstUtxo.input.txHash,
        firstUtxo.input.outputIndex,
        firstUtxo.output.amount,
        firstUtxo.output.address
      )
      .mintPlutusScriptV3()
      .mint('1', policyId, tokenName)
      .mintTxInReference(refScript.txHash, refScript.outputIndex)
      .mintRedeemerValue(mintRedeemer, 'JSON')
      .txOut(encryptionAddress, [
        { unit: 'lovelace', quantity: estimateMinLovelace(datum) },
        { unit: policyId + tokenName, quantity: '1' },
      ])
      .txOutInlineDatumValue(datum, 'JSON')
      .txInCollateral(
        collateral[0].input.txHash,
        collateral[0].input.outputIndex,
        collateral[0].output.amount,
        collateral[0].output.address
      )
      .requiredSignerHash(ownerPkh)
      .metadataValue(674, buildEncryptionMetadata(
        formData.description,
        formData.suggestedPrice || '0',
        getStorageLayerUri(formData),
        formData.imageLink || '',
        formData.category,
      ))
      .changeAddress(changeAddress)
      .selectUtxosFrom(utxos.filter(u =>
        !(u.input.txHash === firstUtxo.input.txHash && u.input.outputIndex === firstUtxo.input.outputIndex)
      ))
      .complete();

    onProgress?.('signing');
    const signedTx = await wallet.signTx(unsignedTx);

    onProgress?.('submitting');
    const txHash = await wallet.submitTx(signedTx);

    if (draftId) {
      await updateListingDraft(draftId, { txHash, status: 'submitted' });
    }

    return {
      success: true,
      txHash,
      tokenName,
      draftId,
    };
  } catch (error) {
    console.error('Failed to create listing:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    // Update draft with error (best-effort)
    if (draftId) {
      try {
        await updateListingDraft(draftId, {
          status: 'failed',
          lastError: errorMsg,
        });
      } catch {
        // Don't mask the original error
      }
    }

    return {
      success: false,
      error: errorMsg,
      draftId,
    };
  }
}

/**
 * Retry creating a listing from a saved draft.
 *
 * Skips file encryption and Iagon upload — uses the already-uploaded file
 * referenced by the draft's iagonFileId. Builds a fresh transaction with
 * the current wallet UTxOs (which may produce a different token name).
 *
 * @param wallet - Connected browser wallet
 * @param draft - The listing draft to retry from
 * @param onProgress - Optional callback for progress UI updates
 * @returns Transaction result
 */
export async function retryListingFromDraft(
  wallet: IWallet,
  draft: ListingDraft,
  onProgress?: (step: ListingCreationStep) => void,
): Promise<TransactionResult> {
  if (!draft.iagonFileId || !draft.fileKey || !draft.fileNonce || !draft.fileDigest) {
    return {
      success: false,
      error: 'Draft is missing upload data. Cannot retry — please create a new listing.',
      draftId: draft.id,
    };
  }

  try {
    // Verify the file is still on Iagon
    onProgress?.('verifying');
    const apiKey = await getStoredApiKey();
    if (!apiKey) {
      throw new Error('Iagon is not connected. Go to Settings > Data Layer to connect.');
    }

    if (draft.iagonFileId) {
      const verified = await verifyIagonUpload(apiKey, draft.iagonFileId);
      if (!verified) {
        await updateListingDraft(draft.id, {
          status: 'failed',
          lastError: 'File no longer found on Iagon. You may need to create a new listing.',
        });
        throw new Error('File no longer found on Iagon. You may need to create a new listing.');
      }
    }

    // Build payload from saved draft fields (no re-upload needed)
    onProgress?.('building');
    const payloadBytes = buildPayloadFromDraftFields(
      draft.iagonFileId,
      draft.fileKey,
      draft.fileNonce,
      draft.fileDigest,
      draft.fileExtension,
    );

    // Fetch config & wallet info
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

    const ownerPkh = extractPaymentKeyHash(usedAddresses[0]);

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

    const artifacts = await createEncryptionWithWallet(
      wallet,
      payloadBytes,
      tokenName,
      false,
    );

    await storeSecrets(tokenName, artifacts.a, artifacts.r);

    await updateListingDraft(draft.id, {
      tokenName,
      status: 'signing',
      retryCount: draft.retryCount + 1,
      lastError: null,
    });

    // Build tx
    const datum = {
      constructor: 0,
      fields: [
        { bytes: ownerPkh },
        artifacts.plutusJson.register,
        { bytes: tokenName },
        artifacts.plutusJson.halfLevel,
        artifacts.plutusJson.fullLevel,
        artifacts.plutusJson.capsule,
        { constructor: 0, fields: [] },
      ],
    };

    const mintRedeemer = {
      constructor: 0,
      fields: [
        artifacts.plutusJson.schnorr,
        artifacts.plutusJson.binding,
      ],
    };

    const txBuilder = createTxBuilder();
    const policyId = config.contracts.encryptionPolicyId;
    const encryptionAddress = config.contracts.encryptionAddress;
    const refScript = config.referenceScripts.encryption;

    const unsignedTx = await txBuilder
      .txIn(
        firstUtxo.input.txHash,
        firstUtxo.input.outputIndex,
        firstUtxo.output.amount,
        firstUtxo.output.address
      )
      .mintPlutusScriptV3()
      .mint('1', policyId, tokenName)
      .mintTxInReference(refScript.txHash, refScript.outputIndex)
      .mintRedeemerValue(mintRedeemer, 'JSON')
      .txOut(encryptionAddress, [
        { unit: 'lovelace', quantity: estimateMinLovelace(datum) },
        { unit: policyId + tokenName, quantity: '1' },
      ])
      .txOutInlineDatumValue(datum, 'JSON')
      .txInCollateral(
        collateral[0].input.txHash,
        collateral[0].input.outputIndex,
        collateral[0].output.amount,
        collateral[0].output.address
      )
      .requiredSignerHash(ownerPkh)
      .metadataValue(674, buildEncryptionMetadata(
        draft.description,
        draft.suggestedPrice || '0',
        'iagon',
        draft.imageLink || '',
        draft.category,
      ))
      .changeAddress(changeAddress)
      .selectUtxosFrom(utxos.filter(u =>
        !(u.input.txHash === firstUtxo.input.txHash && u.input.outputIndex === firstUtxo.input.outputIndex)
      ))
      .complete();

    onProgress?.('signing');
    const signedTx = await wallet.signTx(unsignedTx);

    onProgress?.('submitting');
    const txHash = await wallet.submitTx(signedTx);

    await updateListingDraft(draft.id, { txHash, status: 'submitted' });

    return {
      success: true,
      txHash,
      tokenName,
      draftId: draft.id,
    };
  } catch (error) {
    console.error('Failed to retry listing from draft:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    try {
      await updateListingDraft(draft.id, {
        status: 'failed',
        lastError: errorMsg,
      });
    } catch {
      // Don't mask the original error
    }

    return {
      success: false,
      error: errorMsg,
      draftId: draft.id,
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
    const txBuilder = createTxBuilder();

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
 * Cancel a pending listing (reset Pending → Open).
 *
 * The seller can cancel if they sign, OR anyone can cancel if the TTL has expired.
 * Uses the CancelEncryption redeemer (constructor 3, empty).
 *
 * @param wallet - Connected browser wallet
 * @param encryption - The pending encryption to cancel
 * @returns Transaction result
 */
export async function cancelPendingListing(
  wallet: IWallet,
  encryption: EncryptionDisplay
): Promise<TransactionResult> {
  try {
    if (USE_STUBS) {
      console.warn('[STUB] cancelPendingListing');
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Accept-bid secrets are cleaned up by secretCleanup after confirmed ownership change

      return {
        success: true,
        txHash: `stub_cancel_${Date.now().toString(16)}`,
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
    const encryptionAddress = config.contracts.encryptionAddress;
    const refScript = config.referenceScripts.encryption;

    // 3. Build redeemer: CancelEncryption (constructor 3, empty)
    const spendRedeemer = { constructor: 3, fields: [] };

    // 4. Build output datum: same as current but with status = Open
    const outputDatum = {
      constructor: 0,
      fields: [
        { bytes: encryption.datum.owner_vkh },
        registerToPlutusJson(createPublicRegister(
          encryption.datum.owner_g1.generator,
          encryption.datum.owner_g1.public_value
        )),
        { bytes: encryption.datum.token },
        halfLevelToPlutusJson({
          r1: encryption.datum.half_level.r1b,
          r2_g1: encryption.datum.half_level.r2_g1b,
          r4: encryption.datum.half_level.r4b,
        }),
        encryption.datum.full_level
          ? fullLevelToPlutusJson({
              r1: encryption.datum.full_level.r1b,
              r2_g1: encryption.datum.full_level.r2_g1b,
              r2_g2: encryption.datum.full_level.r2_g2b,
              r4: encryption.datum.full_level.r4b,
            })
          : { constructor: 1, fields: [] }, // None
        { // capsule
          constructor: 0,
          fields: [
            { bytes: encryption.datum.capsule.nonce },
            { bytes: encryption.datum.capsule.aad },
            { bytes: encryption.datum.capsule.ct },
          ],
        },
        { constructor: 0, fields: [] }, // status: Open
      ],
    };

    // 5. Build transaction
    const txBuilder = createTxBuilder();

    const unsignedTx = await txBuilder
      .spendingPlutusScriptV3()
      .txIn(encryption.utxo.txHash, encryption.utxo.outputIndex)
      .spendingTxInReference(refScript.txHash, refScript.outputIndex)
      .txInInlineDatumPresent()
      .txInRedeemerValue(spendRedeemer, 'JSON')
      // Output: encryption with Open status
      .txOut(encryptionAddress, [
        { unit: 'lovelace', quantity: estimateMinLovelace(outputDatum) },
        { unit: policyId + encryption.tokenName, quantity: '1' },
      ])
      .txOutInlineDatumValue(outputDatum, 'JSON')
      .txInCollateral(
        collateral[0].input.txHash,
        collateral[0].input.outputIndex,
        collateral[0].output.amount,
        collateral[0].output.address
      )
      .requiredSignerHash(ownerPkh)
      .metadataValue(674, buildEncryptionMetadata(
        encryption.description || '',
        encryption.suggestedPrice?.toString() || '0',
        encryption.storageLayer || '',
        encryption.imageLink || '',
        encryption.category || '',
      ))
      .changeAddress(changeAddress)
      .selectUtxosFrom(utxos)
      .complete();

    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);

    // Accept-bid secrets are cleaned up by secretCleanup after confirmed ownership change

    return {
      success: true,
      txHash,
      tokenName: encryption.tokenName,
    };
  } catch (error) {
    console.error('Failed to cancel pending listing:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

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
  metadata?: { futurePrice?: number }
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

    const firstUtxo = utxos[0];
    const bidTokenName = computeTokenName(
      firstUtxo.input.txHash,
      firstUtxo.input.outputIndex
    );

    // 5. Generate bid artifacts (prompts wallet signing for sk derivation)
    const artifacts = await createBidArtifactsFromWallet(wallet);

    // 6. Store bidder secret BEFORE submitting transaction
    await storeBidSecrets(bidTokenName, encryptionTokenName, artifacts.b);

    // 7. Find the genesis token UTxO for read-only reference
    const fetcher = getKupoAdapter();
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

    const txBuilder = createTxBuilder();

    const unsignedTx = await txBuilder
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
      .metadataValue(674, buildBidMetadata(
        metadata?.futurePrice?.toString() || '',
      ))
      // Change and UTxO selection
      // Exclude firstUtxo from coin selection pool — it's already an explicit input.
      // Including it causes the selector to undercount available ADA.
      .changeAddress(changeAddress)
      .selectUtxosFrom(utxos.filter(u =>
        !(u.input.txHash === firstUtxo.input.txHash && u.input.outputIndex === firstUtxo.input.outputIndex)
      ))
      .complete();

    // 11. Sign and submit
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);

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
  bid: { tokenName: string; utxo: { txHash: string; outputIndex: number }; datum: { owner_vkh: string; locked_until: number } }
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

    // 6. Build transaction
    const txBuilder = createTxBuilder();

    const unsignedTx = await txBuilder
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

/**
 * Accept a bid by generating and submitting the SNARK proof transaction (Phase 12e).
 *
 * This is step 1 of the two-step accept-bid flow:
 * 1. (12e) SNARK tx: Updates encryption status Open → Pending
 * 2. (12f) Re-encryption tx: Transfers ownership, burns bid token
 *
 * Flow:
 * 1. Generate fresh secrets (a0, r0) for the SNARK proof
 * 2. Compute SNARK public inputs (V, W0, W1)
 * 3. User generates SNARK proof via SnarkProvingModal
 * 4. Parse proof JSON into groth witness redeemer
 * 5. Build transaction: spend encryption + groth withdrawal
 * 6. Store hop secrets for Phase 12f
 * 7. Sign and submit
 *
 * @param wallet - Connected browser wallet
 * @param encryption - The encryption being sold
 * @param bid - The bid being accepted
 * @param snarkProof - The generated SNARK proof (from SnarkProvingModal)
 * @param a0 - Fresh secret scalar a0 (from prepareSnarkInputs)
 * @param r0 - Fresh secret scalar r0 (from prepareSnarkInputs)
 * @returns Transaction result
 */
export async function acceptBidSnark(
  wallet: IWallet,
  encryption: EncryptionDisplay,
  bid: BidDisplay,
  snarkProof: SnarkProof,
  a0: bigint,
  r0: bigint,
  hk: bigint
): Promise<TransactionResult> {
  try {
    if (USE_STUBS) {
      console.warn('[STUB] acceptBidSnark');

      const stubPublic = Array(36).fill(0).map((_, i) => String(i + 1));
      const ttl = Date.now() + 6 * 60 * 60 * 1000 + 40 * 60 * 1000; // now + 6h40m

      const txHash = `stub_snark_${Date.now().toString(16)}`;
      await storeAcceptBidSecrets(
        encryption.tokenName, bid.tokenName, a0, r0, hk,
        stubPublic, ttl, txHash
      );

      await new Promise((resolve) => setTimeout(resolve, 1500));
      return {
        success: true,
        txHash,
        tokenName: encryption.tokenName,
        isStub: true,
      };
    }

    // === REAL IMPLEMENTATION ===

    // 1. Fetch protocol config
    const config = await protocolApi.getConfig();
    if (!config.contracts.encryptionPolicyId) {
      throw new Error('Protocol config missing encryption policy ID.');
    }
    if (!config.contracts.grothPolicyId) {
      throw new Error('Protocol config missing groth policy ID.');
    }
    if (!config.referenceScripts.encryption) {
      throw new Error('Encryption reference script UTxO not configured.');
    }
    if (!config.referenceScripts.groth) {
      throw new Error('Groth reference script UTxO not configured.');
    }
    if (!config.genesisToken) {
      throw new Error('Genesis token not configured in protocol config.');
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

    const usedAddresses = await wallet.getUsedAddresses();
    const ownerPkh = extractPaymentKeyHash(usedAddresses[0]);

    // 3. a0, r0 are passed as parameters (generated by prepareSnarkInputs)
    // No seller secrets (a, r) needed — the SNARK uses fresh random values,
    // and the seller's authority comes from their wallet signature (ownerPkh).

    // 5. Parse SNARK proof JSON
    const proofData = JSON.parse(snarkProof.proofJson);
    const publicData = JSON.parse(snarkProof.publicJson);

    // Extract public inputs as BigInt (skip leading "1" - Aiken IC[0] handles it)
    // gnark outputs 37 values: ["1", limb1, limb2, ..., limb36]
    // The Aiken GrothPublic = List<Int> expects 36 values (without the leading "1")
    const publicInputs: bigint[] = publicData.inputs.slice(1).map((s: string) => BigInt(s));

    // Convert commitment wire from decimal string to 32-byte big-endian hex (ByteArray)
    // The Aiken type GrothCommitmentWire = ByteArray, validator does scalar.from_bytes
    const commitmentWireHex = publicData.commitmentWire
      ? BigInt(publicData.commitmentWire).toString(16).padStart(64, '0')
      : '';

    // Compute TTL: now + 6h40m in POSIX milliseconds
    const ttl = Date.now() + 6 * 60 * 60 * 1000 + 40 * 60 * 1000;

    // 6. Build groth witness redeemer
    // Structure: GrothWitnessRedeemer { groth_proof, groth_commitment_wire, groth_public, ttl }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grothWitnessRedeemer: any = {
      constructor: 0,
      fields: [
        {
          constructor: 0,
          fields: [
            { bytes: proofData.piA },
            { bytes: proofData.piB },
            { bytes: proofData.piC },
            { list: (proofData.commitments || []).map((c: string) => ({ bytes: c })) },
            { bytes: proofData.commitmentPok || '' },
          ],
        },
        { bytes: commitmentWireHex },
        { list: publicInputs.map((v: bigint) => ({ int: v })) },
        { int: ttl },
      ],
    };

    // 7. Build spend redeemer: UseSnark (constructor 2, empty)
    const spendRedeemer = { constructor: 2, fields: [] };

    // 8. Build output datum: same datum but status = Pending(groth_proof, public, ttl)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pendingStatus: any = {
      constructor: 1,
      fields: [
        {
          constructor: 0,
          fields: [
            { bytes: proofData.piA },
            { bytes: proofData.piB },
            { bytes: proofData.piC },
            { list: (proofData.commitments || []).map((c: string) => ({ bytes: c })) },
            { bytes: proofData.commitmentPok || '' },
          ],
        },
        { list: publicInputs.map((v: bigint) => ({ int: v })) },
        { int: ttl },
      ],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outputDatum: any = {
      constructor: 0,
      fields: [
        { bytes: encryption.datum.owner_vkh },
        registerToPlutusJson(createPublicRegister(
          encryption.datum.owner_g1.generator,
          encryption.datum.owner_g1.public_value
        )),
        { bytes: encryption.datum.token },
        halfLevelToPlutusJson({
          r1: encryption.datum.half_level.r1b,
          r2_g1: encryption.datum.half_level.r2_g1b,
          r4: encryption.datum.half_level.r4b,
        }),
        encryption.datum.full_level
          ? fullLevelToPlutusJson({
              r1: encryption.datum.full_level.r1b,
              r2_g1: encryption.datum.full_level.r2_g1b,
              r2_g2: encryption.datum.full_level.r2_g2b,
              r4: encryption.datum.full_level.r4b,
            })
          : { constructor: 1, fields: [] },
        {
          constructor: 0,
          fields: [
            { bytes: encryption.datum.capsule.nonce },
            { bytes: encryption.datum.capsule.aad },
            { bytes: encryption.datum.capsule.ct },
          ],
        },
        pendingStatus, // status: Pending
      ],
    };

    // 9. Find genesis token UTxO for read-only reference
    const fetcher = getKupoAdapter();
    const referenceUtxos = await fetcher.fetchAddressUTxOs(
      config.contracts.referenceAddress
    );
    const genesisUnit = config.genesisToken.policyId + config.genesisToken.tokenName;
    const genesisUtxo = referenceUtxos.find(u =>
      u.output.amount.some(a => a.unit === genesisUnit && parseInt(a.quantity) >= 1)
    );
    if (!genesisUtxo) {
      throw new Error('Genesis token UTxO not found at reference contract address.');
    }

    // 10. Compute groth stake address
    const grothScriptHash = config.contracts.grothPolicyId;
    const grothStakeAddressBech32 = fetchGrothStakeAddress(grothScriptHash, config.network);

    // Query the reward balance (must withdraw the full balance)
    const rewardBalance = await fetchRewardBalance(grothStakeAddressBech32);

    // 11. Compute validity range as slot numbers
    const currentSlot = await fetchCurrentSlot();
    const invalidBefore = currentSlot - 300; // ~5 minutes ago
    const invalidHereafter = currentSlot + 1500; // ~25 minutes from now

    // 12. Build transaction
    const policyId = config.contracts.encryptionPolicyId;
    const encryptionAddress = config.contracts.encryptionAddress;
    const encRefScript = config.referenceScripts.encryption;
    const grothRefScript = config.referenceScripts.groth;

    const txBuilder = createTxBuilder();

    // Build the transaction chain
    txBuilder
      // Spend encryption UTxO with UseSnark redeemer
      .spendingPlutusScriptV3()
      .txIn(encryption.utxo.txHash, encryption.utxo.outputIndex)
      .spendingTxInReference(encRefScript.txHash, encRefScript.outputIndex)
      .txInInlineDatumPresent()
      .txInRedeemerValue(spendRedeemer, 'JSON')
      // Output: encryption with Pending status
      .txOut(encryptionAddress, [
        { unit: 'lovelace', quantity: estimateMinLovelace(outputDatum) },
        { unit: policyId + encryption.tokenName, quantity: '1' },
      ])
      .txOutInlineDatumValue(outputDatum, 'JSON')
      // Groth stake withdrawal (validates the SNARK proof on-chain)
      .withdrawalPlutusScriptV3()
      .withdrawal(grothStakeAddressBech32, rewardBalance)
      .withdrawalTxInReference(grothRefScript.txHash, grothRefScript.outputIndex, '2860', grothScriptHash)
      .withdrawalRedeemerValue(grothWitnessRedeemer, 'JSON')
      // Read-only reference: genesis token UTxO
      .readOnlyTxInReference(genesisUtxo.input.txHash, genesisUtxo.input.outputIndex)
      // Validity range
      .invalidBefore(invalidBefore)
      .invalidHereafter(invalidHereafter)
      // Collateral
      .txInCollateral(
        collateral[0].input.txHash,
        collateral[0].input.outputIndex,
        collateral[0].output.amount,
        collateral[0].output.address
      )
      // Required signer
      .requiredSignerHash(ownerPkh)
      // CIP-20 metadata: carry forward from original listing so Phase 12f can read it
      .metadataValue(674, buildEncryptionMetadata(
        encryption.description || '',
        encryption.suggestedPrice?.toString() || '0',
        encryption.storageLayer || '',
        encryption.imageLink || '',
        encryption.category || '',
      ))
      // Change and UTxO selection
      .changeAddress(changeAddress)
      .selectUtxosFrom(utxos);

    let unsignedTx: string;
    try {
      unsignedTx = await txBuilder.complete();
    } catch (evalError) {
      console.error('[acceptBidSnark] .complete() FAILED - evaluation error:', evalError);
      // Try to get the raw CBOR without evaluation for manual debugging
      try {
        txBuilder.completeSync();
      } catch (syncError) {
        console.error('[acceptBidSnark] completeSync() also failed:', syncError);
      }
      throw evalError;
    }

    // 13. Sign and submit
    const signedTx = await wallet.signTx(unsignedTx);

    let txHash: string;
    try {
      txHash = await wallet.submitTx(signedTx);
    } catch (submitError) {
      console.error('[acceptBidSnark] submitTx FAILED:', submitError);
      throw submitError;
    }

    // 14. Store hop secrets for Phase 12f
    await storeAcceptBidSecrets(
      encryption.tokenName, bid.tokenName, a0, r0, hk,
      publicInputs.map(v => v.toString()), ttl, txHash
    );

    return {
      success: true,
      txHash,
      tokenName: encryption.tokenName,
    };
  } catch (error) {
    console.error('Failed to accept bid (SNARK):', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Prepare SNARK proof inputs for the SnarkProvingModal.
 *
 * Computes V, W0, W1 as public inputs for the vw0w1Circuit:
 *   V  = bidder's G1 public value (from bid datum)
 *   W0 = [hk]G1  where hk = mimc(e([a0]G, H0))
 *   W1 = [a0]G1 + [r0]*V
 *
 * The circuit proves knowledge of (a0, r0) satisfying these relationships.
 *
 * @param bid - The bid being accepted (provides V = bidder's G1 public value)
 * @returns Object with proof inputs and fresh secrets
 */
export async function prepareSnarkInputs(
  bid: BidDisplay
): Promise<{
  inputs: { secretA: string; secretR: string; publicV: string; publicW0: string; publicW1: string };
  a0: bigint;
  r0: bigint;
  hk: bigint;
}> {
  // Generate fresh random secrets for the SNARK proof
  const a0 = rng();
  const r0 = rng();

  // V = bidder's G1 public value
  const V = bid.datum.owner_g1.public_value;

  // Compute hk = mimc(e([a0]G, H0)) via WASM prover
  const prover = getSnarkProver();
  const hkHex = await prover.gtToHash('0x' + a0.toString(16));
  const hk = toInt(hkHex);

  // W0 = [hk]G1
  const W0 = g1Point(hk);

  // W1 = [a0]G1 + [r0]*V
  const W1 = combine(g1Point(a0), scale(V, r0));

  return {
    inputs: {
      secretA: '0x' + a0.toString(16),
      secretR: '0x' + r0.toString(16),
      publicV: V,
      publicW0: W0,
      publicW1: W1,
    },
    a0,
    r0,
    hk,
  };
}

/**
 * Complete the re-encryption transaction (Phase 12f).
 *
 * This is step 2 of the two-step accept-bid flow:
 * 1. (12e) SNARK tx confirmed on-chain (encryption is now Pending)
 * 2. (12f) Re-encryption: Spend encryption + bid UTxOs, burn bid token,
 *          update encryption with new owner and FullEncryptionLevel
 *
 * Flow:
 * 1. Retrieve hop secrets (a0, r0) from IndexedDB
 * 2. Retrieve seller secrets (a, r) for binding proof
 * 3. Compute new half-level and full-level
 * 4. Build UseEncryption redeemer with witness, R5, bid token, binding proof
 * 5. Build transaction: spend encryption + bid, burn bid token
 * 6. Sign and submit
 * 7. Clean up secrets
 *
 * @param wallet - Connected browser wallet
 * @param encryption - The pending encryption (from refreshed on-chain state)
 * @param bid - The accepted bid
 * @returns Transaction result
 */
export async function completeReEncryption(
  wallet: IWallet,
  encryption: EncryptionDisplay,
  bid: BidDisplay
): Promise<TransactionResult> {
  try {
    if (USE_STUBS) {
      console.warn('[STUB] completeReEncryption');
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Accept-bid secrets are cleaned up by secretCleanup after confirmed ownership change

      return {
        success: true,
        txHash: `stub_reencrypt_${Date.now().toString(16)}`,
        tokenName: encryption.tokenName,
        isStub: true,
      };
    }

    // === REAL IMPLEMENTATION ===

    // 1. Fetch protocol config
    const config = await protocolApi.getConfig();
    if (!config.contracts.encryptionPolicyId) {
      throw new Error('Protocol config missing encryption policy ID.');
    }
    if (!config.contracts.biddingPolicyId) {
      throw new Error('Protocol config missing bidding policy ID.');
    }
    if (!config.referenceScripts.encryption) {
      throw new Error('Encryption reference script UTxO not configured.');
    }
    if (!config.referenceScripts.bidding) {
      throw new Error('Bidding reference script UTxO not configured.');
    }
    if (!config.genesisToken) {
      throw new Error('Genesis token not configured in protocol config.');
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

    const usedAddresses = await wallet.getUsedAddresses();
    const ownerPkh = extractPaymentKeyHash(usedAddresses[0]);

    // 3. Retrieve hop secrets from IndexedDB
    const hopSecrets = await getAcceptBidSecrets(encryption.tokenName);
    if (!hopSecrets) {
      throw new Error(
        'Accept-bid secrets not found. The SNARK transaction may not have been submitted ' +
        'or browser data was cleared.'
      );
    }

    // 4. Derive wallet sk (seller's secret key for R5 computation)
    const sk = await deriveSecretFromWallet(wallet);

    const { a0, r0 } = hopSecrets;
    let { hk } = hopSecrets;

    // 4b. Recompute hk from a0 if missing (legacy data stored before hk was added)
    if (!hk || hk === 0n) {
      try {
        const prover = getSnarkProver();
        const hkHex = await prover.gtToHash('0x' + a0.toString(16));
        hk = toInt(hkHex);
      } catch {
        throw new Error(
          'Hop key (hk) not found in stored secrets and WASM prover not available to recompute it. ' +
          'Please open the SNARK prover first (start an accept-bid flow), then retry completing the sale.'
        );
      }
    }

    // 5. Compute the witness point: [hk]G1
    // hk = mimc(e([a0]G1, H0)) was computed in prepareSnarkInputs and stored
    const witnessPoint = g1Point(hk);

    // 6. Compute R5: [hk]G2 + [sk]*(-H0)
    const r5 = combine(g2Point(hk), scale(invertG2(H0), sk));

    // 7. Compute new half-level for the buyer
    // New r1 = [r0]G1
    const newR1 = g1Point(r0);
    // New r2_g1 = [a0]G1 + [r0]*BuyerPublicValue
    const buyerPubValue = bid.datum.owner_g1.public_value;
    const newR2G1 = combine(g1Point(a0), scale(buyerPubValue, r0));

    // Compute kth-level commitment (NO H3 for kth level!)
    // a_coeff = H2I(r1)
    // b_coeff = H2I(r1 || r2_g1 || token)
    // c = [a_coeff]*H1 + [b_coeff]*H2
    // r4 = [r0]*c
    const aCoeff = toInt(generate(H2I_DOMAIN_TAG + newR1));
    const bCoeff = toInt(generate(H2I_DOMAIN_TAG + newR1 + newR2G1 + encryption.datum.token));
    const c = combine(scale(H1, aCoeff), scale(H2, bCoeff)); // NO H3 for kth level
    const newR4 = scale(c, r0);

    // 8. Build full-level using OLD half-level + new R5 (matches on-chain validator)
    const newFullLevel = {
      r1: encryption.datum.half_level.r1b,
      r2_g1: encryption.datum.half_level.r2_g1b,
      r2_g2: r5,
      r4: encryption.datum.half_level.r4b,
    };

    // 9. Build binding proof against BUYER's register (verified on-chain against bid_owner_g1)
    const buyerRegister = createPublicRegister(
      bid.datum.owner_g1.generator,
      bid.datum.owner_g1.public_value
    );
    const binding = bindingProof(a0, r0, newR1, newR2G1, buyerRegister, encryption.datum.token);

    // 10. Build UseEncryption redeemer (constructor 1)
    // Fields: witness_point, r5_point, bid_token_name, binding_proof
    const encryptionRedeemer = {
      constructor: 1,
      fields: [
        { bytes: witnessPoint },
        { bytes: r5 },
        { bytes: bid.tokenName },
        bindingToPlutusJson(binding),
      ],
    };

    // 11. Build UseBid redeemer (constructor 1, empty)
    const bidRedeemer = { constructor: 1, fields: [] };

    // 12. Build LeaveBidBurn redeemer (constructor 1)
    const bidBurnRedeemer = {
      constructor: 1,
      fields: [{ bytes: bid.tokenName }],
    };

    // 13. Build output datum: buyer becomes new owner, new half-level, full-level, status = Open
    const outputDatum = {
      constructor: 0,
      fields: [
        { bytes: bid.datum.owner_vkh }, // new owner = buyer
        registerToPlutusJson(buyerRegister), // buyer's register
        { bytes: encryption.datum.token }, // same token name
        halfLevelToPlutusJson({ r1: newR1, r2_g1: newR2G1, r4: newR4 }), // new half-level
        fullLevelToPlutusJson(newFullLevel), // full-level (Some): old half + new R5
        { // capsule unchanged
          constructor: 0,
          fields: [
            { bytes: encryption.datum.capsule.nonce },
            { bytes: encryption.datum.capsule.aad },
            { bytes: encryption.datum.capsule.ct },
          ],
        },
        { constructor: 0, fields: [] }, // status: Open
      ],
    };

    // 15. Find genesis token UTxO
    const fetcher = getKupoAdapter();
    const referenceUtxos = await fetcher.fetchAddressUTxOs(
      config.contracts.referenceAddress
    );
    const genesisUnit = config.genesisToken.policyId + config.genesisToken.tokenName;
    const genesisUtxo = referenceUtxos.find(u =>
      u.output.amount.some(a => a.unit === genesisUnit && parseInt(a.quantity) >= 1)
    );
    if (!genesisUtxo) {
      throw new Error('Genesis token UTxO not found at reference contract address.');
    }

    // 16. Refresh encryption UTxO from Kupo
    // After Phase 12e, the old encryption UTxO was spent and a new one created.
    // The encryption object from React state may reference the old (spent) UTxO.
    const encPolicyId = config.contracts.encryptionPolicyId;
    const bidPolicyId = config.contracts.biddingPolicyId;
    const encryptionAddress = config.contracts.encryptionAddress;
    const encRefScript = config.referenceScripts.encryption;
    const bidRefScript = config.referenceScripts.bidding;

    const encUnit = encPolicyId + encryption.tokenName;
    const encryptionUtxos = await fetcher.fetchAddressUTxOs(encryptionAddress);
    const currentEncUtxo = encryptionUtxos.find(u =>
      u.output.amount.some(a => a.unit === encUnit && parseInt(a.quantity) >= 1)
    );
    if (!currentEncUtxo) {
      throw new Error(
        'Encryption UTxO not found on-chain. Phase 12e may not have confirmed yet. ' +
        'Please wait a minute and try again.'
      );
    }

    const txBuilder = createTxBuilder();

    const unsignedTx = await txBuilder
      // Spend encryption UTxO with UseEncryption redeemer
      .spendingPlutusScriptV3()
      .txIn(currentEncUtxo.input.txHash, currentEncUtxo.input.outputIndex)
      .spendingTxInReference(encRefScript.txHash, encRefScript.outputIndex)
      .txInInlineDatumPresent()
      .txInRedeemerValue(encryptionRedeemer, 'JSON')
      // Spend bid UTxO with UseBid redeemer
      .spendingPlutusScriptV3()
      .txIn(bid.utxo.txHash, bid.utxo.outputIndex)
      .spendingTxInReference(bidRefScript.txHash, bidRefScript.outputIndex)
      .txInInlineDatumPresent()
      .txInRedeemerValue(bidRedeemer, 'JSON')
      // Output: encryption with new owner, new level, Open status
      .txOut(encryptionAddress, [
        { unit: 'lovelace', quantity: estimateMinLovelace(outputDatum) },
        { unit: encPolicyId + encryption.tokenName, quantity: '1' },
      ])
      .txOutInlineDatumValue(outputDatum, 'JSON')
      // Burn -1 bid token
      .mintPlutusScriptV3()
      .mint('-1', bidPolicyId, bid.tokenName)
      .mintTxInReference(bidRefScript.txHash, bidRefScript.outputIndex)
      .mintRedeemerValue(bidBurnRedeemer, 'JSON')
      // Read-only reference: genesis token UTxO
      .readOnlyTxInReference(genesisUtxo.input.txHash, genesisUtxo.input.outputIndex)
      // Collateral
      .txInCollateral(
        collateral[0].input.txHash,
        collateral[0].input.outputIndex,
        collateral[0].output.amount,
        collateral[0].output.address
      )
      // Required signer
      .requiredSignerHash(ownerPkh)
      // CIP-20 metadata: carry forward description, storageLayer, category; use bidder's future price
      .metadataValue(674, buildEncryptionMetadata(
        encryption.description || '',
        (bid.futurePrice ?? bid.amount / 1_000_000).toString(),
        encryption.storageLayer || '',
        encryption.imageLink || '',
        encryption.category || '',
      ))
      // Change and UTxO selection
      .changeAddress(changeAddress)
      .selectUtxosFrom(utxos)
      .complete();

    // 17. Sign and submit
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);

    // Store (a0, r0) as seller secrets so secretCleanup can track this token.
    // These match the new encryption's half-level and will be deleted after
    // confirmed ownership change (K=15 blocks).
    await storeSecrets(encryption.tokenName, a0, r0);

    // Accept-bid secrets are cleaned up by secretCleanup after confirmed ownership change

    return {
      success: true,
      txHash,
      tokenName: encryption.tokenName,
    };
  } catch (error) {
    console.error('Failed to complete re-encryption:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Compute the groth stake address from the script hash.
 * Constructs the bech32 stake address from the script hash.
 */
function fetchGrothStakeAddress(
  scriptHash: string,
  network: 'preprod' | 'mainnet'
): string {
  // Script stake credential header byte: 0xf0 (testnet) / 0xf1 (mainnet)
  const headerByte = network === 'mainnet' ? 0xf1 : 0xf0;
  const scriptHashBytes = hexToUint8Array(scriptHash);
  const addressBytes = new Uint8Array(1 + scriptHashBytes.length);
  addressBytes[0] = headerByte;
  addressBytes.set(scriptHashBytes, 1);

  const prefix = network === 'mainnet' ? 'stake' : 'stake_test';
  const words = bech32.toWords(addressBytes);
  return bech32.encode(prefix, words, 120);
}

/**
 * Return the reward balance for the groth stake address.
 *
 * The groth stake address is a Plutus V3 script address used solely to trigger
 * the groth validator via withdrawal. It is never delegated to a pool and never
 * earns staking rewards, so the balance is always "0". The withdrawal of "0" is
 * valid and exists only to trigger the groth validator script on-chain.
 */
async function fetchRewardBalance(
  _stakeAddress: string
): Promise<string> {
  return '0';
}

/**
 * Fetch the current slot number from local Ogmios health endpoint.
 * Ogmios /health returns JSON with lastKnownTip.slot.
 */
async function fetchCurrentSlot(): Promise<number> {
  const response = await fetch('http://127.0.0.1:1337/health');
  if (!response.ok) {
    throw new Error(`Ogmios health check failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.lastKnownTip?.slot || 0;
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
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
      'Set VITE_USE_STUBS=false to enable real transactions.'
    );
  }
  return '';
}
