/**
 * Wallet Management Service
 *
 * Provides collateral creation and UTxO defragmentation for optimal
 * transaction building. Uses MeshTxBuilder with local Kupo + Ogmios.
 *
 * All token quantities use BigInt to handle Cardano's max value (2^63 - 1).
 */

import { MeshTxBuilder } from '@meshsdk/core'
import type { IWallet, UTxO, Asset } from '@meshsdk/core'
import { getKupoAdapter, getOgmiosProvider } from './providers'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Cardano protocol parameter: lovelace cost per UTxO byte (Babbage/Conway era).
 * Bigint variant of txUtils.COINS_PER_UTXO_BYTE for use with BigInt arithmetic.
 */
const COINS_PER_UTXO_BYTE = 4310n

/** Maximum token quantity per UTxO output (2^63 - 1). */
const MAX_QUANTITY = (1n << 63n) - 1n

/** Collateral target in lovelace (5 ADA). */
const COLLATERAL_LOVELACE = 5_000_000n

/** Minimum total lovelace to create collateral (5 ADA + 1 ADA for change/fee). */
const COLLATERAL_MIN_TOTAL = 6_500_000n

/** Tolerance for detecting an existing collateral UTxO (±0.5 ADA). */
const COLLATERAL_TOLERANCE = 500_000n

/** Maximum number of UTxO inputs per defrag transaction (tx size safety). */
const MAX_DEFRAG_INPUTS = 200

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

export interface WalletManagementResult {
  success: boolean
  txHash?: string
  error?: string
}

/** A planned token output from the packing algorithm. */
export interface PlannedTokenOutput {
  assets: Asset[]
  minLovelace: bigint
}

/** Dry-run analysis of what defrag would produce. */
export interface DefragPreview {
  inputCount: number
  tokenOutputs: PlannedTokenOutput[]
  totalLockedByTokens: bigint
  estimatedChangeLovelace: bigint
  resultingUtxoCount: number
  isFeasible: boolean
  infeasibleReason?: string
  capped: boolean
}

/** Analysis of the current wallet UTxO set. */
export interface UtxoAnalysis {
  hasCollateral: boolean
  utxoCount: number
  pureAdaCount: number
  tokenUtxoCount: number
  distinctAssetCount: number
  isFragmented: boolean
}

// ---------------------------------------------------------------------------
// CBOR Encoding Size Helpers
// ---------------------------------------------------------------------------

/** Number of bytes to CBOR-encode an unsigned integer. */
export function cborUintBytes(n: bigint): bigint {
  if (n < 0n) return 9n
  if (n <= 23n) return 1n
  if (n <= 0xffn) return 2n
  if (n <= 0xffffn) return 3n
  if (n <= 0xffffffffn) return 5n
  return 9n
}

/** Number of bytes for a CBOR map header given entry count. */
export function cborMapHeaderBytes(count: number): bigint {
  if (count <= 23) return 1n
  if (count <= 255) return 2n
  if (count <= 65535) return 3n
  return 5n
}

/** Number of bytes for a CBOR bytestring header given payload length. */
export function cborBytestringHeaderBytes(len: bigint): bigint {
  if (len <= 23n) return 1n
  if (len <= 0xffn) return 2n
  if (len <= 0xffffn) return 3n
  return 5n
}

// ---------------------------------------------------------------------------
// Min Lovelace Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the exact minimum lovelace required for a UTxO holding the given
 * native assets. Uses the Babbage/Conway era formula with precise CBOR sizing.
 * No safety margin — returns the protocol-mandated minimum.
 */
export function calculateMinLovelace(assets: Asset[]): bigint {
  if (assets.length === 0) return 1_000_000n

  // Group by policy ID
  const policies = new Map<string, Array<{ name: string; qty: bigint }>>()
  for (const asset of assets) {
    const policyId = asset.unit.substring(0, 56)
    const assetName = asset.unit.substring(56)
    const list = policies.get(policyId) ?? []
    list.push({ name: assetName, qty: BigInt(asset.quantity) })
    policies.set(policyId, list)
  }

  // CBOR-serialized value size: [lovelace, {policy: {name: qty, ...}, ...}]
  let valueBytes = 0n

  // Lovelace field: worst-case uint encoding (9 bytes for large values)
  valueBytes += 9n

  // Outer map header (policies)
  valueBytes += cborMapHeaderBytes(policies.size)

  for (const [, tokens] of policies) {
    // Policy hash: 28 bytes + CBOR bytestring header (2 bytes for 28-byte payload)
    valueBytes += 30n

    // Inner map header (asset names within this policy)
    valueBytes += cborMapHeaderBytes(tokens.length)

    for (const token of tokens) {
      // Asset name bytes
      const nameBytes = BigInt(token.name.length / 2) // hex chars → bytes
      valueBytes += nameBytes + cborBytestringHeaderBytes(nameBytes)

      // Quantity: CBOR uint encoding
      valueBytes += cborUintBytes(token.qty)
    }
  }

  // Formula: max(1_000_000, (160 + valueBytes) * coinsPerUTxOByte)
  const minLovelace = (160n + valueBytes) * COINS_PER_UTXO_BYTE
  return minLovelace > 1_000_000n ? minLovelace : 1_000_000n
}

// ---------------------------------------------------------------------------
// UTxO Helpers
// ---------------------------------------------------------------------------

/** Sum all lovelace across a set of UTxOs. */
export function sumLovelace(utxos: UTxO[]): bigint {
  let total = 0n
  for (const utxo of utxos) {
    const lv = utxo.output.amount.find((a) => a.unit === 'lovelace')
    if (lv) total += BigInt(lv.quantity)
  }
  return total
}

/** True if UTxO contains only lovelace (no native tokens). */
export function isPureAda(utxo: UTxO): boolean {
  return utxo.output.amount.every((a) => a.unit === 'lovelace')
}

/** True if UTxO looks like a dedicated collateral (pure ADA, ~5 ADA). */
export function isLikelyCollateral(utxo: UTxO): boolean {
  if (!isPureAda(utxo)) return false
  const lv = utxo.output.amount.find((a) => a.unit === 'lovelace')
  if (!lv) return false
  const lovelace = BigInt(lv.quantity)
  const diff = lovelace > COLLATERAL_LOVELACE
    ? lovelace - COLLATERAL_LOVELACE
    : COLLATERAL_LOVELACE - lovelace
  return diff <= COLLATERAL_TOLERANCE
}

// ---------------------------------------------------------------------------
// UTxO Analysis
// ---------------------------------------------------------------------------

/** Analyze the wallet UTxO set for health indicators. */
export function analyzeUtxoSet(utxos: UTxO[]): UtxoAnalysis {
  const distinctAssets = new Set<string>()
  let pureAdaCount = 0
  let tokenUtxoCount = 0
  let hasCollateral = false

  for (const utxo of utxos) {
    if (isPureAda(utxo)) {
      pureAdaCount++
      if (isLikelyCollateral(utxo)) hasCollateral = true
    } else {
      tokenUtxoCount++
      for (const asset of utxo.output.amount) {
        if (asset.unit !== 'lovelace') distinctAssets.add(asset.unit)
      }
    }
  }

  const isFragmented =
    utxos.length > 0 &&
    (utxos.length > 10 || tokenUtxoCount > 3 || !hasCollateral)

  return {
    hasCollateral,
    utxoCount: utxos.length,
    pureAdaCount,
    tokenUtxoCount,
    distinctAssetCount: distinctAssets.size,
    isFragmented,
  }
}

// ---------------------------------------------------------------------------
// Token Packing Algorithm
// ---------------------------------------------------------------------------

interface TokenPlacement {
  unit: string
  quantity: bigint
  isOverflow: boolean
}

/**
 * Plan the optimal set of token UTxO outputs for defragmentation.
 *
 * Strategy:
 * 1. Aggregate all tokens across UTxOs (BigInt sums)
 * 2. Split any quantity exceeding MAX_QUANTITY (2^63 - 1) into multiple placements
 * 3. Group normal placements by policy ID (shared 28-byte overhead)
 * 4. Overflow placements get their own dedicated UTxO each
 * 5. Calculate exact min ADA per output
 */
export function planTokenOutputs(utxos: UTxO[]): PlannedTokenOutput[] {
  // Step 1: Aggregate all tokens
  const aggregated = new Map<string, bigint>()
  for (const utxo of utxos) {
    for (const asset of utxo.output.amount) {
      if (asset.unit === 'lovelace') continue
      const current = aggregated.get(asset.unit) ?? 0n
      aggregated.set(asset.unit, current + BigInt(asset.quantity))
    }
  }

  if (aggregated.size === 0) return []

  // Step 2: Split overflow quantities into placements
  const placements: TokenPlacement[] = []
  for (const [unit, totalQty] of aggregated) {
    if (totalQty <= MAX_QUANTITY) {
      placements.push({ unit, quantity: totalQty, isOverflow: false })
    } else {
      // Split into ceil(totalQty / MAX_QUANTITY) chunks
      let remaining = totalQty
      while (remaining > 0n) {
        const chunk = remaining > MAX_QUANTITY ? MAX_QUANTITY : remaining
        placements.push({ unit, quantity: chunk, isOverflow: true })
        remaining -= chunk
      }
    }
  }

  // Step 3: Group by policy ID
  const policyGroups = new Map<string, TokenPlacement[]>()
  for (const placement of placements) {
    const policyId = placement.unit.substring(0, 56)
    const group = policyGroups.get(policyId) ?? []
    group.push(placement)
    policyGroups.set(policyId, group)
  }

  // Step 4: Assign to outputs
  const outputs: PlannedTokenOutput[] = []

  for (const [, group] of policyGroups) {
    // Separate normal and overflow placements
    const normal: TokenPlacement[] = []
    const overflow: TokenPlacement[] = []
    for (const p of group) {
      if (p.isOverflow) {
        overflow.push(p)
      } else {
        normal.push(p)
      }
    }

    // Normal placements from the same policy → one UTxO
    if (normal.length > 0) {
      const assets: Asset[] = normal.map((p) => ({
        unit: p.unit,
        quantity: p.quantity.toString(),
      }))
      outputs.push({ assets, minLovelace: calculateMinLovelace(assets) })
    }

    // Each overflow placement → its own UTxO
    for (const p of overflow) {
      const assets: Asset[] = [{ unit: p.unit, quantity: p.quantity.toString() }]
      outputs.push({ assets, minLovelace: calculateMinLovelace(assets) })
    }
  }

  return outputs
}

// ---------------------------------------------------------------------------
// Defrag Preview
// ---------------------------------------------------------------------------

/** Estimate transaction fee for defrag (conservative). */
const ESTIMATED_FEE = 300_000n
/** Minimum lovelace for the change output. */
const MIN_CHANGE_LOVELACE = 1_000_000n

/**
 * Analyze what a defrag transaction would produce without building it.
 */
export async function previewDefrag(wallet: IWallet): Promise<DefragPreview> {
  const utxos = await wallet.getUtxos()

  const capped = utxos.length > MAX_DEFRAG_INPUTS
  const inputUtxos = capped ? utxos.slice(0, MAX_DEFRAG_INPUTS) : utxos
  const inputCount = inputUtxos.length
  const totalLovelace = sumLovelace(inputUtxos)
  const tokenOutputs = planTokenOutputs(inputUtxos)

  const totalLockedByTokens = tokenOutputs.reduce(
    (sum, o) => sum + o.minLovelace,
    0n,
  )

  const estimatedChange =
    totalLovelace - totalLockedByTokens - COLLATERAL_LOVELACE - ESTIMATED_FEE

  // 1 change output + 1 collateral output + N token outputs
  const resultingUtxoCount = 2 + tokenOutputs.length

  const isFeasible = estimatedChange >= MIN_CHANGE_LOVELACE
  let infeasibleReason: string | undefined
  if (inputCount <= 1) {
    return {
      inputCount,
      tokenOutputs,
      totalLockedByTokens,
      estimatedChangeLovelace: estimatedChange > 0n ? estimatedChange : 0n,
      resultingUtxoCount,
      isFeasible: false,
      infeasibleReason: 'Wallet has only 1 UTxO. Nothing to defragment.',
      capped,
    }
  }
  if (!isFeasible) {
    const needed = totalLockedByTokens + COLLATERAL_LOVELACE + MIN_CHANGE_LOVELACE + ESTIMATED_FEE
    const neededAda = Number(needed) / 1_000_000
    infeasibleReason = `Insufficient ADA. Need at least ${neededAda.toFixed(1)} ADA to cover collateral, token UTxOs, and fees.`
  }

  return {
    inputCount,
    tokenOutputs,
    totalLockedByTokens,
    estimatedChangeLovelace: estimatedChange > 0n ? estimatedChange : 0n,
    resultingUtxoCount,
    isFeasible: isFeasible && inputCount > 1,
    infeasibleReason,
    capped,
  }
}

// ---------------------------------------------------------------------------
// Create Collateral
// ---------------------------------------------------------------------------

/**
 * Build and submit a transaction that creates a 5 ADA pure-lovelace
 * collateral UTxO. Change goes back to the wallet.
 */
export async function createCollateral(
  wallet: IWallet,
): Promise<WalletManagementResult> {
  try {
    const utxos = await wallet.getUtxos()
    if (utxos.length === 0) {
      return { success: false, error: 'No UTxOs found in wallet.' }
    }

    // Check if suitable collateral already exists
    const existing = utxos.find((u) => isLikelyCollateral(u))
    if (existing) {
      return { success: true, error: 'Collateral UTxO already exists.' }
    }

    // Check sufficient funds
    const totalLovelace = sumLovelace(utxos)
    if (totalLovelace < COLLATERAL_MIN_TOTAL) {
      const totalAda = Number(totalLovelace) / 1_000_000
      return {
        success: false,
        error: `Insufficient funds. Need at least 6.5 ADA (5 collateral + 1 change/fee) but wallet has ${totalAda.toFixed(2)} ADA.`,
      }
    }

    const changeAddress = await wallet.getChangeAddress()

    const txBuilder = new MeshTxBuilder({
      fetcher: getKupoAdapter(),
      evaluator: getOgmiosProvider(),
    })

    const unsignedTx = await txBuilder
      .txOut(changeAddress, [
        { unit: 'lovelace', quantity: COLLATERAL_LOVELACE.toString() },
      ])
      .changeAddress(changeAddress)
      .selectUtxosFrom(utxos)
      .complete()

    const signedTx = await wallet.signTx(unsignedTx)
    const txHash = await wallet.submitTx(signedTx)

    return { success: true, txHash }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// ---------------------------------------------------------------------------
// Defrag Wallet
// ---------------------------------------------------------------------------

/**
 * Build and submit a defragmentation transaction that consolidates all
 * wallet UTxOs into an optimized set:
 *   - Minimal token UTxO(s) packing native assets by policy with min ADA each
 *   - One large pure-lovelace change UTxO (maximized)
 *
 * This does NOT create a collateral UTxO — use createCollateral separately.
 */
export async function defragWallet(
  wallet: IWallet,
): Promise<WalletManagementResult> {
  try {
    const utxos = await wallet.getUtxos()
    if (utxos.length === 0) {
      return { success: false, error: 'No UTxOs found in wallet.' }
    }
    if (utxos.length === 1) {
      return {
        success: false,
        error: 'Wallet has only 1 UTxO. Nothing to defragment.',
      }
    }

    // Cap inputs for tx size safety
    const inputUtxos = utxos.length > MAX_DEFRAG_INPUTS
      ? utxos.slice(0, MAX_DEFRAG_INPUTS)
      : utxos

    const totalLovelace = sumLovelace(inputUtxos)
    const tokenOutputs = planTokenOutputs(inputUtxos)

    const totalLockedByTokens = tokenOutputs.reduce(
      (sum, o) => sum + o.minLovelace,
      0n,
    )

    // Feasibility: need enough ADA for collateral + token UTxOs + min change + fee
    const minRequired = totalLockedByTokens + COLLATERAL_LOVELACE + MIN_CHANGE_LOVELACE + ESTIMATED_FEE
    if (totalLovelace < minRequired) {
      const neededAda = Number(minRequired) / 1_000_000
      const haveAda = Number(totalLovelace) / 1_000_000
      return {
        success: false,
        error: `Insufficient ADA. Need at least ${neededAda.toFixed(1)} ADA to cover token UTxOs and fees, but wallet has ${haveAda.toFixed(2)} ADA.`,
      }
    }

    const changeAddress = await wallet.getChangeAddress()

    const txBuilder = new MeshTxBuilder({
      fetcher: getKupoAdapter(),
      evaluator: getOgmiosProvider(),
    })

    // Add ALL UTxOs as explicit inputs (we want everything consumed)
    for (const utxo of inputUtxos) {
      txBuilder.txIn(
        utxo.input.txHash,
        utxo.input.outputIndex,
        utxo.output.amount,
        utxo.output.address,
      )
    }

    // Add collateral output (5 ADA pure lovelace)
    txBuilder.txOut(changeAddress, [
      { unit: 'lovelace', quantity: COLLATERAL_LOVELACE.toString() },
    ])

    // Add token outputs (one per policy group / overflow placement)
    for (const output of tokenOutputs) {
      txBuilder.txOut(changeAddress, [
        { unit: 'lovelace', quantity: output.minLovelace.toString() },
        ...output.assets,
      ])
    }

    // Change becomes the big lovelace-only UTxO
    const unsignedTx = await txBuilder
      .changeAddress(changeAddress)
      .complete()

    const signedTx = await wallet.signTx(unsignedTx)
    const txHash = await wallet.submitTx(signedTx)

    let result: WalletManagementResult = { success: true, txHash }
    if (utxos.length > MAX_DEFRAG_INPUTS) {
      result = {
        ...result,
        error: `Optimized ${MAX_DEFRAG_INPUTS} of ${utxos.length} UTxOs. Run again to continue.`,
      }
    }
    return result
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
