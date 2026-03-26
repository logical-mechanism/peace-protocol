/**
 * Listing Lifecycle Transactions
 *
 * Create, retry, remove, and cancel encryption listings.
 */

import type { IWallet } from '@meshsdk/core';
import { createEncryptionWithWallet, getStubWarning } from '../crypto';
import {
  registerToPlutusJson, createPublicRegister,
  halfLevelToPlutusJson, fullLevelToPlutusJson,
} from '../crypto';
import { storeSecrets } from '../secretStorage';
import { buildPayload } from '../crypto/payload';
import { protocolApi } from '../api';
import type { EncryptionDisplay } from '../api';
import type { CreateListingFormData } from '../../components/CreateListingModal';
import type { FileCategory } from '../../config/categories';
import { buildEncryptionMetadata } from '../metadata';
import { encodeFileSecret } from '../crypto/fileEncryption';
import { encryptAndUpload, listFiles as iagonListFiles } from '../iagonApi';
import { getStoredApiKey } from '../iagonAuth';
import { hexToBytes } from '../crypto/bls12381';
import {
  createListingDraft,
  updateListingDraft,
  type ListingDraft,
} from '../listingDraftStorage';
import { copyToLibrary, saveContentMetadata } from '../contentStorage';
import { getPendingTxPool } from '../providers';

import {
  USE_STUBS,
  type TransactionResult,
  type ListingCreationStep,
  excludeUtxos,
  withTimeout,
  estimateMinLovelace,
  computeTokenName,
  extractPaymentKeyHash,
  getStorageLayerUri,
  createTxBuilder,
} from './txUtils';

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
 * @param filePath - Absolute path to file on disk
 * @param fileName - Original file name (for extension detection)
 * @param tokenName - Token name for the listing (used as Iagon filename)
 * @returns CBOR-encoded peace-payload bytes
 */
async function buildPayloadForIagon(filePath: string, fileName: string, tokenName: string): Promise<Uint8Array> {
  const apiKey = await getStoredApiKey();
  if (!apiKey) {
    throw new Error('Iagon is not connected. Go to Settings > Data Layer to connect.');
  }

  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
  const iagonFilename = `${tokenName}${ext}.enc`;

  // Encrypt + upload in Rust (no large byte arrays cross IPC)
  const result = await encryptAndUpload(apiKey, filePath, iagonFilename);

  // Build peace-payload with Iagon reference
  const locator = new TextEncoder().encode(result.file_info._id);
  const key = hexToBytes(result.key_hex);
  const nonce = hexToBytes(result.nonce_hex);
  const digest = hexToBytes(result.digest_hex);
  const secret = encodeFileSecret(key, nonce);

  let extra: Map<number, Uint8Array> | undefined;
  if (ext) {
    extra = new Map();
    extra.set(3, new TextEncoder().encode(ext));
  }

  return buildPayload({ locator, secret, digest, extra });
}

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
  onSubmitted?: (txHash: string, tokenName?: string) => void,
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
        : await buildPayloadForIagon(formData.filePath!, formData.fileName || formData.file?.name || 'file', tokenName);
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
      // All heavy byte operations (read, encrypt, upload) happen in Rust
      // to avoid Tauri IPC JSON serialization memory amplification.
      draftId = crypto.randomUUID();

      const fileName = formData.fileName || formData.file?.name || 'file';
      const fileSize = formData.fileSize ?? formData.file?.size ?? 0;
      const filePath = formData.filePath;
      if (!filePath) {
        throw new Error('No file selected. Please choose a file to upload.');
      }

      onProgress?.('encrypting');
      await createListingDraft(
        draftId,
        formData.category,
        formData.description,
        formData.suggestedPrice || '0',
        formData.imageLink || '',
        fileName,
        fileSize,
      );

      // Extract original file extension for payload field 3 (filetype)
      const ext = fileName.includes('.')
        ? fileName.slice(fileName.lastIndexOf('.'))
        : '';

      // Upload to Iagon (encrypt + upload happens in Rust)
      onProgress?.('uploading');
      const apiKey = await getStoredApiKey();
      if (!apiKey) {
        throw new Error('Iagon is not connected. Go to Settings > Data Layer to connect.');
      }
      // Use draft ID for filename since token name isn't known yet
      const iagonFilename = `${draftId}${ext}.enc`;

      const uploadResult = await encryptAndUpload(apiKey, filePath, iagonFilename);
      const fileKeyHex = uploadResult.key_hex;
      const fileNonceHex = uploadResult.nonce_hex;
      const fileDigestHex = uploadResult.digest_hex;
      const fileInfo = uploadResult.file_info;

      // Save encryption keys + file extension to draft after upload
      await updateListingDraft(draftId, {
        fileKey: fileKeyHex,
        fileNonce: fileNonceHex,
        fileDigest: fileDigestHex,
        fileExtension: ext || undefined,
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

    // Pick the first UTxO that isn't the collateral to avoid consuming it as a regular input.
    const nonCollateral = excludeUtxos(utxos, collateral[0]);
    if (nonCollateral.length === 0) {
      throw new Error('No non-collateral UTxOs available. Send more ADA to your wallet.');
    }
    const firstUtxo = nonCollateral[0];
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
        // new_price (lovelace)
        { int: Math.floor(parseFloat(formData.suggestedPrice || '0') * 1_000_000) },
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

    const unsignedTx = await withTimeout(
      txBuilder
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
          getStorageLayerUri(formData),
          formData.imageLink || '',
          formData.category,
        ))
        .changeAddress(changeAddress)
        .selectUtxosFrom(excludeUtxos(utxos, firstUtxo, collateral[0]))
        .complete(),
      180_000,
      'createListing tx build',
    );


    onProgress?.('signing');
    const signedTx = await wallet.signTx(unsignedTx);

    onProgress?.('submitting');
    const txHash = await wallet.submitTx(signedTx);
    await getPendingTxPool().registerTx(signedTx, txHash);
    try { onSubmitted?.(txHash, tokenName); } catch { /* don't break tx flow */ }

    if (draftId) {
      await updateListingDraft(draftId, { txHash, status: 'submitted' });
    }

    // Add the seller's own file to their library (best-effort, non-blocking)
    if (formData.filePath && formData.category !== 'text') {
      try {
        const ext = formData.fileName
          ? '.' + formData.fileName.split('.').pop()
          : undefined;
        await copyToLibrary(formData.filePath, tokenName, formData.category, ext);
        await saveContentMetadata({
          tokenName,
          description: formData.description,
          suggestedPrice: formData.suggestedPrice ? parseFloat(formData.suggestedPrice) : undefined,
          storageLayer: getStorageLayerUri(formData),
          imageLink: formData.imageLink || undefined,
          category: formData.category,
          fileExtension: ext,
          decryptedAt: new Date().toISOString(),
          fileSize: formData.fileSize ?? undefined,
        });
      } catch (err) {
        console.warn('[createListing] Failed to add file to library:', err);
      }
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
  onSubmitted?: (txHash: string, tokenName?: string) => void,
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

    // Pick the first UTxO that isn't the collateral to avoid consuming it as a regular input.
    const nonCollateral = excludeUtxos(utxos, collateral[0]);
    if (nonCollateral.length === 0) {
      throw new Error('No non-collateral UTxOs available. Send more ADA to your wallet.');
    }
    const firstUtxo = nonCollateral[0];
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
        // new_price (lovelace)
        { int: Math.floor(parseFloat(draft.suggestedPrice || '0') * 1_000_000) },
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

    const unsignedTx = await withTimeout(
      txBuilder
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
          'iagon',
          draft.imageLink || '',
          draft.category,
        ))
        .changeAddress(changeAddress)
        .selectUtxosFrom(excludeUtxos(utxos, firstUtxo, collateral[0]))
        .complete(),
      180_000,
      'retryListingFromDraft tx build',
    );

    onProgress?.('signing');
    const signedTx = await wallet.signTx(unsignedTx);

    onProgress?.('submitting');
    const txHash = await wallet.submitTx(signedTx);
    await getPendingTxPool().registerTx(signedTx, txHash);
    try { onSubmitted?.(txHash, tokenName); } catch { /* don't break tx flow */ }

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
  encryption: { tokenName: string; utxo: { txHash: string; outputIndex: number }; datum: { owner_vkh: string } },
  onSubmitted?: (txHash: string, tokenName?: string) => void,
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

    const unsignedTx = await withTimeout(
      txBuilder
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
        .selectUtxosFrom(excludeUtxos(utxos, collateral[0]))
        .complete(),
      180_000,
      'removeListing tx build',
    );

    // 5. Sign and submit
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);
    await getPendingTxPool().registerTx(signedTx, txHash);
    try { onSubmitted?.(txHash, encryption.tokenName); } catch { /* don't break tx flow */ }

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
  encryption: EncryptionDisplay,
  onSubmitted?: (txHash: string, tokenName?: string) => void,
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
        // new_price (lovelace) — suggestedPrice is already in lovelace from datum
        { int: encryption.datum.new_price },
      ],
    };

    // 5. Build transaction
    const txBuilder = createTxBuilder();

    const unsignedTx = await withTimeout(
      txBuilder
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
          encryption.storageLayer || '',
          encryption.imageLink || '',
          encryption.category || '',
        ))
        .changeAddress(changeAddress)
        .selectUtxosFrom(excludeUtxos(utxos, collateral[0]))
        .complete(),
      180_000,
      'cancelPendingListing tx build',
    );

    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);
    await getPendingTxPool().registerTx(signedTx, txHash);
    try { onSubmitted?.(txHash, encryption.tokenName); } catch { /* don't break tx flow */ }

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
 * Data required to create a listing from an already-uploaded Iagon file.
 * The user provides the Iagon file ID and the encryption parameters that
 * were generated when they originally encrypted and uploaded the file.
 */
export interface ImportListingData {
  iagonFileId: string;
  aesKeyHex: string;      // 64 hex chars (32 bytes)
  gcmNonceHex: string;    // 24 hex chars (12 bytes)
  sha256DigestHex: string; // 64 hex chars (32 bytes)
  fileExtension: string;   // e.g. ".pdf"
  description: string;
  suggestedPrice: string;
  imageLink: string;
  category: FileCategory;
}

/**
 * Create a listing from an existing Iagon upload.
 *
 * Skips file encryption, upload, and verification — the file is already on
 * Iagon and the user provides the encryption parameters directly.
 *
 * Progress steps: building → signing → submitting (same as text listings).
 */
export async function createListingFromImport(
  wallet: IWallet,
  data: ImportListingData,
  onProgress?: (step: ListingCreationStep) => void,
  onSubmitted?: (txHash: string, tokenName?: string) => void,
): Promise<TransactionResult> {
  try {
    // STUB MODE
    if (USE_STUBS) {
      console.warn('[STUB] createListingFromImport - using stub mode');
      const fakeUtxo = { txHash: Array(64).fill('b').join(''), outputIndex: 0 };
      const tokenName = computeTokenName(fakeUtxo.txHash, fakeUtxo.outputIndex);
      const payloadBytes = buildPayloadFromDraftFields(
        data.iagonFileId, data.aesKeyHex, data.gcmNonceHex, data.sha256DigestHex, data.fileExtension,
      );
      const artifacts = await createEncryptionWithWallet(wallet, payloadBytes, tokenName, true);
      await storeSecrets(tokenName, artifacts.a, artifacts.r);
      return {
        success: true,
        txHash: `stub_${Date.now().toString(16)}_${tokenName.slice(0, 16)}`,
        tokenName,
        isStub: true,
      };
    }

    // === REAL IMPLEMENTATION ===

    onProgress?.('building');

    // Build payload from user-provided Iagon data
    const payloadBytes = buildPayloadFromDraftFields(
      data.iagonFileId, data.aesKeyHex, data.gcmNonceHex, data.sha256DigestHex, data.fileExtension,
    );

    // Fetch config
    const config = await protocolApi.getConfig();
    if (!config.contracts.encryptionAddress || !config.contracts.encryptionPolicyId) {
      throw new Error('Protocol config missing contract addresses. Ensure backend .env is configured.');
    }
    if (!config.referenceScripts.encryption) {
      throw new Error('Encryption reference script UTxO not configured.');
    }

    // Wallet info
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
      throw new Error('No collateral set in wallet.');
    }

    const ownerPkh = extractPaymentKeyHash(usedAddresses[0]);

    utxos.sort((a, b) => {
      const hashCmp = a.input.txHash.localeCompare(b.input.txHash);
      if (hashCmp !== 0) return hashCmp;
      return a.input.outputIndex - b.input.outputIndex;
    });

    const nonCollateral = excludeUtxos(utxos, collateral[0]);
    if (nonCollateral.length === 0) {
      throw new Error('No non-collateral UTxOs available. Send more ADA to your wallet.');
    }
    const firstUtxo = nonCollateral[0];
    const tokenName = computeTokenName(firstUtxo.input.txHash, firstUtxo.input.outputIndex);

    // Create encryption artifacts
    const artifacts = await createEncryptionWithWallet(wallet, payloadBytes, tokenName, false);
    await storeSecrets(tokenName, artifacts.a, artifacts.r);

    // Build transaction
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
        // new_price (lovelace)
        { int: Math.floor(parseFloat(data.suggestedPrice || '0') * 1_000_000) },
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

    const storageLayer = 'iagon';
    const unsignedTx = await withTimeout(
      txBuilder
        .txIn(firstUtxo.input.txHash, firstUtxo.input.outputIndex, firstUtxo.output.amount, firstUtxo.output.address)
        .mintPlutusScriptV3()
        .mint('1', policyId, tokenName)
        .mintTxInReference(refScript.txHash, refScript.outputIndex)
        .mintRedeemerValue(mintRedeemer, 'JSON')
        .txOut(encryptionAddress, [
          { unit: 'lovelace', quantity: estimateMinLovelace(datum) },
          { unit: policyId + tokenName, quantity: '1' },
        ])
        .txOutInlineDatumValue(datum, 'JSON')
        .txInCollateral(collateral[0].input.txHash, collateral[0].input.outputIndex, collateral[0].output.amount, collateral[0].output.address)
        .requiredSignerHash(ownerPkh)
        .metadataValue(674, buildEncryptionMetadata(
          data.description,
          storageLayer,
          data.imageLink || '',
          data.category,
        ))
        .changeAddress(changeAddress)
        .selectUtxosFrom(excludeUtxos(utxos, firstUtxo, collateral[0]))
        .complete(),
      180_000,
      'createListingFromImport tx build',
    );

    onProgress?.('signing');
    const signedTx = await wallet.signTx(unsignedTx);

    onProgress?.('submitting');
    const txHash = await wallet.submitTx(signedTx);
    await getPendingTxPool().registerTx(signedTx, txHash);
    try { onSubmitted?.(txHash, tokenName); } catch { /* don't break tx flow */ }

    return { success: true, txHash, tokenName };
  } catch (error) {
    console.error('Failed to create listing from import:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
