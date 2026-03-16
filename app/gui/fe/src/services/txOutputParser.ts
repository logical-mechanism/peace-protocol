/**
 * Transaction Output Parser
 *
 * Extracts UTxO inputs and outputs from signed transaction CBOR using
 * @meshsdk/core-cst's deserializeTx. This enables the pending tx pool
 * to know exactly which UTxOs a submitted transaction consumes and creates,
 * without waiting for Kupo to index the on-chain state.
 *
 * NOTE: @meshsdk/core-cst is imported lazily (dynamic import) to avoid
 * pulling in its heavy transitive deps (libsodium WASM) at module load
 * time. This keeps providers.ts → pendingTxPool.ts → txOutputParser.ts
 * lightweight for tests and initial app load.
 */

import type { UTxO, Asset } from '@meshsdk/core';

/** A consumed input reference */
export interface TxInput {
  txHash: string;
  outputIndex: number;
}

/** Lazy-loaded deserializeTx to avoid eager WASM initialization */
async function getDeserializeTx() {
  const { deserializeTx } = await import('@meshsdk/core-cst');
  return deserializeTx;
}

/**
 * Parse the inputs (spent UTxOs) from a signed transaction CBOR.
 *
 * @param signedTxCbor - Hex-encoded signed transaction CBOR
 * @returns Array of input references (txHash + outputIndex)
 */
export async function parseTxInputs(signedTxCbor: string): Promise<TxInput[]> {
  const deserializeTx = await getDeserializeTx();
  const tx = deserializeTx(signedTxCbor);
  const inputs = tx.body().inputs().values();

  return inputs.map((input) => ({
    txHash: input.transactionId().toString(),
    outputIndex: Number(input.index().toString()),
  }));
}

/**
 * Parse the outputs (created UTxOs) from a signed transaction CBOR.
 *
 * Converts each output into MeshSDK's UTxO format so they can be
 * seamlessly merged with real Kupo results by the ChainingAdapter.
 *
 * @param signedTxCbor - Hex-encoded signed transaction CBOR
 * @param txHash - The transaction hash (from wallet.submitTx or tx.getId())
 * @returns Array of UTxOs in MeshSDK format
 */
export async function parseTxOutputs(signedTxCbor: string, txHash: string): Promise<UTxO[]> {
  const deserializeTx = await getDeserializeTx();
  const tx = deserializeTx(signedTxCbor);
  const outputs = tx.body().outputs();
  const result: UTxO[] = [];

  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i];

    // Build amount array: lovelace first
    const amount: Asset[] = [
      { unit: 'lovelace', quantity: output.amount().coin().toString() },
    ];

    // Add multiasset entries if present
    const multiasset = output.amount().multiasset();
    if (multiasset) {
      // multiasset is a Map<ScriptHash, Map<AssetName, bigint>>
      // Use toCore() which returns a standard Map structure
      const coreValue = output.amount().toCore();
      if (coreValue.assets) {
        for (const [assetId, qty] of coreValue.assets) {
          amount.push({ unit: assetId.toString(), quantity: qty.toString() });
        }
      }
    }

    // Extract inline datum CBOR if present
    let plutusData: string | undefined;
    const datum = output.datum();
    if (datum) {
      // datum could be a DataHash or inline PlutusData
      // Try to get the CBOR representation
      try {
        plutusData = datum.toCbor();
      } catch {
        // datum might be a hash reference, not inline data
      }
    }

    // Extract datum hash if present (separate from inline datum)
    let dataHash: string | undefined;
    if (!plutusData && datum) {
      try {
        dataHash = datum.toString();
      } catch {
        // ignore
      }
    }

    // Extract script reference if present
    let scriptRef: string | undefined;
    let scriptHash: string | undefined;
    const sRef = output.scriptRef();
    if (sRef) {
      try {
        scriptRef = sRef.toCbor();
        scriptHash = sRef.hash?.()?.toString();
      } catch {
        // ignore
      }
    }

    // Get bech32 address
    let address: string;
    try {
      address = output.address().toBech32();
    } catch {
      // Fallback to hex if bech32 encoding fails (e.g. Byron addresses)
      address = output.address().toBytes().toString();
    }

    result.push({
      input: {
        txHash,
        outputIndex: i,
      },
      output: {
        address,
        amount,
        dataHash,
        plutusData,
        scriptHash,
        scriptRef,
      },
    });
  }

  return result;
}
