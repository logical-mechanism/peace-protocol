/**
 * Accept-Bid & Re-Encryption Transactions
 *
 * Two-step SNARK-based bid acceptance:
 * - Phase 12e: Submit SNARK proof (acceptBidSnark)
 * - Phase 12f: Complete re-encryption (completeReEncryption)
 * - Chained: acceptBidAndReEncrypt combines both
 */

import type { IWallet } from '@meshsdk/core';
import {
  rng, g1Point, g2Point, scale, combine, invertG2, toInt, generate,
  H0, H1, H2, H2I_DOMAIN_TAG,
  createPublicRegister, registerToPlutusJson,
  bindingProof, bindingToPlutusJson,
  halfLevelToPlutusJson, fullLevelToPlutusJson,
} from '../crypto';
import { storeSecrets } from '../secretStorage';
import { storeAcceptBidSecrets, getAcceptBidSecrets } from '../acceptBidStorage';
import { deriveSecretFromWallet } from '../crypto/walletSecret';
import { protocolApi } from '../api';
import type { EncryptionDisplay, BidDisplay } from '../api';
import { getSnarkProver, type SnarkProof } from '../snark';
import { buildEncryptionMetadata } from '../metadata';
import { getChainingAdapter, getPendingTxPool } from '../providers';
import { bech32 } from '@scure/base';

import {
  USE_STUBS,
  type TransactionResult,
  type ChainedAcceptStep,
  excludeUtxos,
  withTimeout,
  estimateMinLovelace,
  extractPaymentKeyHash,
  createTxBuilder,
  fetchCurrentSlot,
  hexToUint8Array,
} from './txUtils';

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
  hk: bigint,
  onSubmitted?: (txHash: string, tokenName?: string) => void,
): Promise<TransactionResult> {
  try {
    if (USE_STUBS) {
      console.warn('[STUB] acceptBidSnark');

      // 36 public inputs matching the Groth16 circuit's expected public input count
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
        { int: encryption.datum.new_price }, // new_price: carry forward from current datum
      ],
    };

    // 9. Find genesis token UTxO for read-only reference
    const fetcher = getChainingAdapter();
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
        encryption.storageLayer || '',
        encryption.imageLink || '',
        encryption.category || '',
      ))
      // Change and UTxO selection
      .changeAddress(changeAddress)
      .selectUtxosFrom(excludeUtxos(utxos, collateral[0]));

    let unsignedTx: string;
    try {
      unsignedTx = await withTimeout(txBuilder.complete(), 180_000, 'acceptBidSnark tx build');
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
      await getPendingTxPool().registerTx(signedTx, txHash);
      try { onSubmitted?.(txHash, encryption.tokenName); } catch { /* don't break tx flow */ }
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
  bid: BidDisplay,
  onSubmitted?: (txHash: string, tokenName?: string) => void,
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
        { int: bid.datum.new_price }, // new_price: from bid datum (bidder's desired resale price)
      ],
    };

    // 15. Find genesis token UTxO
    const fetcher = getChainingAdapter();
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

    const unsignedTx = await withTimeout(
      txBuilder
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
        // CIP-20 metadata: carry forward description, storageLayer, category
        .metadataValue(674, buildEncryptionMetadata(
          encryption.description || '',
          encryption.storageLayer || '',
          encryption.imageLink || '',
          encryption.category || '',
        ))
        // Change and UTxO selection
        .changeAddress(changeAddress)
        .selectUtxosFrom(excludeUtxos(utxos, collateral[0]))
        .complete(),
      180_000,
      'completeReEncryption tx build',
    );

    // 17. Sign and submit
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);
    await getPendingTxPool().registerTx(signedTx, txHash);
    try { onSubmitted?.(txHash, encryption.tokenName); } catch { /* don't break tx flow */ }

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
 * Accept a bid and immediately chain the re-encryption transaction.
 *
 * Combines Phase 12e (acceptBidSnark) and Phase 12f (completeReEncryption)
 * into a single operation using transaction chaining. After the SNARK tx
 * is submitted, its outputs are tracked in the PendingTxPool, allowing
 * the re-encryption tx to be built and submitted without waiting for
 * on-chain confirmation.
 *
 * If the chained re-encryption fails (e.g. Ogmios rejects the mempool
 * reference), the SNARK tx (12e) is already submitted and will confirm
 * on-chain. The user can manually complete re-encryption later.
 *
 * @param wallet - Connected wallet
 * @param encryption - The encryption being sold
 * @param bid - The accepted bid
 * @param snarkProof - Generated SNARK proof
 * @param a0 - Fresh secret for re-encryption
 * @param r0 - Fresh random for re-encryption
 * @param hk - Hash key derived from a0
 * @param onStep - Progress callback for UI updates
 * @returns Transaction result with the final txHash (from re-encryption)
 */
export async function acceptBidAndReEncrypt(
  wallet: IWallet,
  encryption: EncryptionDisplay,
  bid: BidDisplay,
  snarkProof: SnarkProof,
  a0: bigint,
  r0: bigint,
  hk: bigint,
  onStep?: (step: ChainedAcceptStep) => void,
  onSnarkSubmitted?: (txHash: string, tokenName?: string) => void,
  onReEncryptSubmitted?: (txHash: string, tokenName?: string) => void,
): Promise<TransactionResult> {
  // Phase 12e: Submit SNARK proof tx
  onStep?.('submitting-snark');
  const snarkResult = await acceptBidSnark(wallet, encryption, bid, snarkProof, a0, r0, hk, onSnarkSubmitted);

  if (!snarkResult.success) {
    return snarkResult;
  }

  // Phase 12f: Chain the re-encryption tx.
  // evaluateTx now passes additionalUtxo from PendingTxPool so Ogmios can
  // resolve the SNARK tx's outputs without waiting for on-chain confirmation.
  onStep?.('building-reencrypt');

  try {
    onStep?.('submitting-reencrypt');
    const reEncryptResult = await completeReEncryption(wallet, encryption, bid, onReEncryptSubmitted);

    if (reEncryptResult.success) {
      onStep?.('complete');
      return { ...reEncryptResult, snarkTxHash: snarkResult.txHash };
    }

    // Re-encryption failed but SNARK tx is already submitted
    console.warn(
      '[acceptBidAndReEncrypt] Re-encryption failed, SNARK tx still pending:',
      snarkResult.txHash,
      'Error:', reEncryptResult.error,
    );
    onStep?.('fallback');
    return {
      success: true,
      txHash: snarkResult.txHash,
      snarkTxHash: snarkResult.txHash,
      tokenName: encryption.tokenName,
      error: `SNARK proof submitted (${snarkResult.txHash}), but re-encryption failed: ${reEncryptResult.error}. You can complete the sale manually after the SNARK tx confirms.`,
    };
  } catch (chainError) {
    const errorMsg = chainError instanceof Error ? chainError.message : 'Unknown error';
    console.warn(
      '[acceptBidAndReEncrypt] Re-encryption threw, SNARK tx still pending:',
      snarkResult.txHash,
      'Error:', errorMsg,
    );
    onStep?.('fallback');
    return {
      success: true,
      txHash: snarkResult.txHash,
      snarkTxHash: snarkResult.txHash,
      tokenName: encryption.tokenName,
      error: `SNARK proof submitted (${snarkResult.txHash}), but re-encryption failed: ${errorMsg}. You can complete the sale manually after the SNARK tx confirms.`,
    };
  }
}
