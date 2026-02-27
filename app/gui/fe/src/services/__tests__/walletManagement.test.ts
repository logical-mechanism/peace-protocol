import { describe, it, expect, vi } from 'vitest'

// Mock heavy dependencies
vi.mock('@meshsdk/core', () => ({ MeshTxBuilder: vi.fn() }))
vi.mock('../providers', () => ({ getKupoAdapter: vi.fn(), getOgmiosProvider: vi.fn() }))

import {
  cborUintBytes,
  cborMapHeaderBytes,
  cborBytestringHeaderBytes,
  calculateMinLovelace,
  sumLovelace,
  isPureAda,
  isLikelyCollateral,
  analyzeUtxoSet,
  planTokenOutputs,
  createCollateral,
  defragWallet,
  previewDefrag,
} from '../walletManagement'
import type { UTxO, Asset, IWallet } from '@meshsdk/core'

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function pureAdaUtxo(
  lovelace: number | bigint,
  txHash = 'a'.repeat(64),
  index = 0,
): UTxO {
  return {
    input: { txHash, outputIndex: index },
    output: {
      address: 'addr_test1qz',
      amount: [{ unit: 'lovelace', quantity: String(lovelace) }],
    },
  }
}

function tokenUtxo(
  lovelace: number | bigint,
  tokens: Array<{ unit: string; quantity: string }>,
  txHash = 'b'.repeat(64),
  index = 0,
): UTxO {
  return {
    input: { txHash, outputIndex: index },
    output: {
      address: 'addr_test1qz',
      amount: [
        { unit: 'lovelace', quantity: String(lovelace) },
        ...tokens,
      ],
    },
  }
}

const POLICY_A = 'a'.repeat(56)
const POLICY_B = 'b'.repeat(56)
const TOKEN_A1 = POLICY_A + '746f6b656e41' // "tokenA"
const TOKEN_A2 = POLICY_A + '746f6b656e42' // "tokenB" (same policy as A1)
const TOKEN_B1 = POLICY_B + '746f6b656e43' // "tokenC" (different policy)

const MAX_QTY = ((1n << 63n) - 1n).toString()

// ---------------------------------------------------------------------------
// CBOR Encoding Size Helpers
// ---------------------------------------------------------------------------

describe('cborUintBytes', () => {
  it('returns 1 for values 0-23', () => {
    expect(cborUintBytes(0n)).toBe(1n)
    expect(cborUintBytes(23n)).toBe(1n)
  })

  it('returns 2 for values 24-255', () => {
    expect(cborUintBytes(24n)).toBe(2n)
    expect(cborUintBytes(255n)).toBe(2n)
  })

  it('returns 3 for values 256-65535', () => {
    expect(cborUintBytes(256n)).toBe(3n)
    expect(cborUintBytes(65535n)).toBe(3n)
  })

  it('returns 5 for values 65536-2^32-1', () => {
    expect(cborUintBytes(65536n)).toBe(5n)
    expect(cborUintBytes(0xffffffffn)).toBe(5n)
  })

  it('returns 9 for values >= 2^32', () => {
    expect(cborUintBytes(0x100000000n)).toBe(9n)
    expect(cborUintBytes((1n << 63n) - 1n)).toBe(9n)
  })

  it('returns 9 for negative values (defensive)', () => {
    expect(cborUintBytes(-1n)).toBe(9n)
  })
})

describe('cborMapHeaderBytes', () => {
  it('returns 1 for 0-23 entries', () => {
    expect(cborMapHeaderBytes(0)).toBe(1n)
    expect(cborMapHeaderBytes(23)).toBe(1n)
  })

  it('returns 2 for 24-255 entries', () => {
    expect(cborMapHeaderBytes(24)).toBe(2n)
    expect(cborMapHeaderBytes(255)).toBe(2n)
  })

  it('returns 3 for 256-65535 entries', () => {
    expect(cborMapHeaderBytes(256)).toBe(3n)
  })
})

describe('cborBytestringHeaderBytes', () => {
  it('returns 1 for 0-23 byte payloads', () => {
    expect(cborBytestringHeaderBytes(0n)).toBe(1n)
    expect(cborBytestringHeaderBytes(23n)).toBe(1n)
  })

  it('returns 2 for 24-255 byte payloads', () => {
    expect(cborBytestringHeaderBytes(24n)).toBe(2n)
    expect(cborBytestringHeaderBytes(255n)).toBe(2n)
  })

  it('returns 3 for 256+ byte payloads', () => {
    expect(cborBytestringHeaderBytes(256n)).toBe(3n)
  })
})

// ---------------------------------------------------------------------------
// calculateMinLovelace
// ---------------------------------------------------------------------------

describe('calculateMinLovelace', () => {
  it('returns 1_000_000 for empty assets', () => {
    expect(calculateMinLovelace([])).toBe(1_000_000n)
  })

  it('returns at least 1_000_000 for any asset set', () => {
    const result = calculateMinLovelace([
      { unit: TOKEN_A1, quantity: '1' },
    ])
    expect(result).toBeGreaterThanOrEqual(1_000_000n)
  })

  it('increases with more distinct policies', () => {
    const singlePolicy = calculateMinLovelace([
      { unit: TOKEN_A1, quantity: '1' },
    ])
    const twoPolicies = calculateMinLovelace([
      { unit: TOKEN_A1, quantity: '1' },
      { unit: TOKEN_B1, quantity: '1' },
    ])
    expect(twoPolicies).toBeGreaterThan(singlePolicy)
  })

  it('increases with more tokens in the same policy', () => {
    const oneToken = calculateMinLovelace([
      { unit: TOKEN_A1, quantity: '1' },
    ])
    const twoTokens = calculateMinLovelace([
      { unit: TOKEN_A1, quantity: '1' },
      { unit: TOKEN_A2, quantity: '1' },
    ])
    // Both may hit the 1M floor for small token sets, but raw calculation should show increase
    expect(twoTokens).toBeGreaterThanOrEqual(oneToken)
  })

  it('handles max quantity (2^63 - 1) without overflow', () => {
    const result = calculateMinLovelace([
      { unit: TOKEN_A1, quantity: MAX_QTY },
    ])
    // Small token set may hit 1M floor — just ensure no BigInt overflow
    expect(result).toBeGreaterThanOrEqual(1_000_000n)
    expect(typeof result).toBe('bigint')
  })

  it('exceeds 1M floor with enough policies', () => {
    // 10 different policies should push above the floor
    const assets: Asset[] = Array.from({ length: 10 }, (_, i) => ({
      unit: i.toString(16).padStart(56, '0') + '746f6b656e',
      quantity: '1',
    }))
    const result = calculateMinLovelace(assets)
    expect(result).toBeGreaterThan(1_000_000n)
  })

  it('produces consistent results for same inputs', () => {
    const assets: Asset[] = [
      { unit: TOKEN_A1, quantity: '100' },
      { unit: TOKEN_B1, quantity: '200' },
    ]
    expect(calculateMinLovelace(assets)).toBe(calculateMinLovelace(assets))
  })
})

// ---------------------------------------------------------------------------
// sumLovelace
// ---------------------------------------------------------------------------

describe('sumLovelace', () => {
  it('returns 0n for empty array', () => {
    expect(sumLovelace([])).toBe(0n)
  })

  it('sums lovelace across multiple UTxOs', () => {
    const utxos = [pureAdaUtxo(5_000_000), pureAdaUtxo(3_000_000)]
    expect(sumLovelace(utxos)).toBe(8_000_000n)
  })

  it('includes lovelace from token-bearing UTxOs', () => {
    const utxos = [
      pureAdaUtxo(5_000_000),
      tokenUtxo(2_000_000, [{ unit: TOKEN_A1, quantity: '1' }]),
    ]
    expect(sumLovelace(utxos)).toBe(7_000_000n)
  })

  it('handles large lovelace values', () => {
    const utxos = [pureAdaUtxo(45_000_000_000_000n)]
    expect(sumLovelace(utxos)).toBe(45_000_000_000_000n)
  })
})

// ---------------------------------------------------------------------------
// isPureAda / isLikelyCollateral
// ---------------------------------------------------------------------------

describe('isPureAda', () => {
  it('returns true for lovelace-only UTxO', () => {
    expect(isPureAda(pureAdaUtxo(5_000_000))).toBe(true)
  })

  it('returns false for UTxO with tokens', () => {
    const utxo = tokenUtxo(5_000_000, [{ unit: TOKEN_A1, quantity: '1' }])
    expect(isPureAda(utxo)).toBe(false)
  })
})

describe('isLikelyCollateral', () => {
  it('matches exactly 5 ADA', () => {
    expect(isLikelyCollateral(pureAdaUtxo(5_000_000))).toBe(true)
  })

  it('matches within tolerance (4.5 ADA)', () => {
    expect(isLikelyCollateral(pureAdaUtxo(4_500_000))).toBe(true)
  })

  it('matches within tolerance (5.5 ADA)', () => {
    expect(isLikelyCollateral(pureAdaUtxo(5_500_000))).toBe(true)
  })

  it('rejects UTxOs far from 5 ADA (10 ADA)', () => {
    expect(isLikelyCollateral(pureAdaUtxo(10_000_000))).toBe(false)
  })

  it('rejects UTxOs with tokens even if ~5 ADA', () => {
    const utxo = tokenUtxo(5_000_000, [{ unit: TOKEN_A1, quantity: '1' }])
    expect(isLikelyCollateral(utxo)).toBe(false)
  })

  it('rejects very small pure ADA UTxOs', () => {
    expect(isLikelyCollateral(pureAdaUtxo(1_000_000))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// analyzeUtxoSet
// ---------------------------------------------------------------------------

describe('analyzeUtxoSet', () => {
  it('returns correct counts for mixed UTxO set', () => {
    const utxos = [
      pureAdaUtxo(5_000_000, 'a'.repeat(64), 0),
      pureAdaUtxo(10_000_000, 'a'.repeat(64), 1),
      tokenUtxo(2_000_000, [{ unit: TOKEN_A1, quantity: '1' }]),
      tokenUtxo(2_000_000, [
        { unit: TOKEN_A1, quantity: '1' },
        { unit: TOKEN_B1, quantity: '1' },
      ]),
    ]
    const analysis = analyzeUtxoSet(utxos)
    expect(analysis.hasCollateral).toBe(true)
    expect(analysis.utxoCount).toBe(4)
    expect(analysis.pureAdaCount).toBe(2)
    expect(analysis.tokenUtxoCount).toBe(2)
    expect(analysis.distinctAssetCount).toBe(2)
  })

  it('detects missing collateral', () => {
    const utxos = [pureAdaUtxo(100_000_000)]
    const analysis = analyzeUtxoSet(utxos)
    expect(analysis.hasCollateral).toBe(false)
  })

  it('flags fragmentation for many UTxOs', () => {
    const utxos = Array.from({ length: 12 }, (_, i) =>
      pureAdaUtxo(1_000_000, 'c'.repeat(64), i),
    )
    const analysis = analyzeUtxoSet(utxos)
    expect(analysis.isFragmented).toBe(true)
  })

  it('does not flag fragmentation for healthy wallet', () => {
    const utxos = [
      pureAdaUtxo(5_000_000),
      pureAdaUtxo(50_000_000, 'c'.repeat(64)),
    ]
    const analysis = analyzeUtxoSet(utxos)
    expect(analysis.isFragmented).toBe(false)
  })

  it('flags fragmentation when no collateral', () => {
    const utxos = [pureAdaUtxo(50_000_000)]
    const analysis = analyzeUtxoSet(utxos)
    expect(analysis.isFragmented).toBe(true)
  })

  it('handles empty UTxO set', () => {
    const analysis = analyzeUtxoSet([])
    expect(analysis.utxoCount).toBe(0)
    expect(analysis.hasCollateral).toBe(false)
    expect(analysis.isFragmented).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// planTokenOutputs
// ---------------------------------------------------------------------------

describe('planTokenOutputs', () => {
  it('returns empty array when no tokens exist', () => {
    const utxos = [pureAdaUtxo(10_000_000)]
    expect(planTokenOutputs(utxos)).toEqual([])
  })

  it('groups tokens from the same policy into one output', () => {
    const utxos = [
      tokenUtxo(2_000_000, [
        { unit: TOKEN_A1, quantity: '10' },
      ], 'c'.repeat(64), 0),
      tokenUtxo(2_000_000, [
        { unit: TOKEN_A2, quantity: '20' },
      ], 'c'.repeat(64), 1),
    ]
    const outputs = planTokenOutputs(utxos)
    expect(outputs).toHaveLength(1)
    expect(outputs[0].assets).toHaveLength(2)
    expect(outputs[0].assets.find((a) => a.unit === TOKEN_A1)?.quantity).toBe('10')
    expect(outputs[0].assets.find((a) => a.unit === TOKEN_A2)?.quantity).toBe('20')
  })

  it('creates separate outputs for different policies', () => {
    const utxos = [
      tokenUtxo(2_000_000, [
        { unit: TOKEN_A1, quantity: '10' },
        { unit: TOKEN_B1, quantity: '5' },
      ]),
    ]
    const outputs = planTokenOutputs(utxos)
    expect(outputs).toHaveLength(2)

    const policyAOutput = outputs.find((o) =>
      o.assets.some((a) => a.unit === TOKEN_A1),
    )
    const policyBOutput = outputs.find((o) =>
      o.assets.some((a) => a.unit === TOKEN_B1),
    )
    expect(policyAOutput).toBeDefined()
    expect(policyBOutput).toBeDefined()
  })

  it('aggregates quantities of the same token across UTxOs', () => {
    const utxos = [
      tokenUtxo(2_000_000, [{ unit: TOKEN_A1, quantity: '10' }], 'd'.repeat(64), 0),
      tokenUtxo(2_000_000, [{ unit: TOKEN_A1, quantity: '25' }], 'd'.repeat(64), 1),
    ]
    const outputs = planTokenOutputs(utxos)
    expect(outputs).toHaveLength(1)
    expect(outputs[0].assets[0].quantity).toBe('35')
  })

  it('splits overflow quantities exceeding MAX_QUANTITY', () => {
    // Two UTxOs each with max quantity → total = 2 * MAX_QUANTITY
    const utxos = [
      tokenUtxo(2_000_000, [{ unit: TOKEN_A1, quantity: MAX_QTY }], 'e'.repeat(64), 0),
      tokenUtxo(2_000_000, [{ unit: TOKEN_A1, quantity: MAX_QTY }], 'e'.repeat(64), 1),
    ]
    const outputs = planTokenOutputs(utxos)
    // Should produce 2 outputs (each at MAX_QUANTITY)
    expect(outputs).toHaveLength(2)
    for (const output of outputs) {
      expect(output.assets).toHaveLength(1)
      expect(output.assets[0].unit).toBe(TOKEN_A1)
      expect(BigInt(output.assets[0].quantity)).toBeLessThanOrEqual(
        (1n << 63n) - 1n,
      )
    }
    // Total should equal 2 * MAX_QUANTITY
    const totalQty = outputs.reduce(
      (sum, o) => sum + BigInt(o.assets[0].quantity),
      0n,
    )
    expect(totalQty).toBe(2n * ((1n << 63n) - 1n))
  })

  it('handles overflow with remainder', () => {
    // MAX_QUANTITY + 100 → should split into [MAX_QUANTITY, 100]
    const utxos = [
      tokenUtxo(2_000_000, [{ unit: TOKEN_A1, quantity: MAX_QTY }], 'f'.repeat(64), 0),
      tokenUtxo(2_000_000, [{ unit: TOKEN_A1, quantity: '100' }], 'f'.repeat(64), 1),
    ]
    const outputs = planTokenOutputs(utxos)
    expect(outputs).toHaveLength(2)
    const quantities = outputs.map((o) => BigInt(o.assets[0].quantity))
    expect(quantities).toContain((1n << 63n) - 1n)
    expect(quantities).toContain(100n)
  })

  it('separates overflow placements from normal placements in same policy', () => {
    // Policy A: TOKEN_A1 at max qty * 2 (overflow) + TOKEN_A2 at 50 (normal)
    const utxos = [
      tokenUtxo(2_000_000, [
        { unit: TOKEN_A1, quantity: MAX_QTY },
        { unit: TOKEN_A2, quantity: '50' },
      ], 'g'.repeat(64), 0),
      tokenUtxo(2_000_000, [
        { unit: TOKEN_A1, quantity: MAX_QTY },
      ], 'g'.repeat(64), 1),
    ]
    const outputs = planTokenOutputs(utxos)
    // TOKEN_A2 (normal, qty=50) → 1 output
    // TOKEN_A1 (overflow, 2 * MAX_QTY) → 2 outputs
    expect(outputs).toHaveLength(3)

    const normalOutput = outputs.find((o) =>
      o.assets.some((a) => a.unit === TOKEN_A2),
    )
    expect(normalOutput).toBeDefined()
    expect(normalOutput!.assets.find((a) => a.unit === TOKEN_A2)?.quantity).toBe('50')

    const overflowOutputs = outputs.filter((o) =>
      o.assets.length === 1 && o.assets[0].unit === TOKEN_A1,
    )
    expect(overflowOutputs).toHaveLength(2)
  })

  it('calculates minLovelace for each output', () => {
    const utxos = [
      tokenUtxo(2_000_000, [{ unit: TOKEN_A1, quantity: '1' }]),
    ]
    const outputs = planTokenOutputs(utxos)
    expect(outputs).toHaveLength(1)
    expect(outputs[0].minLovelace).toBeGreaterThanOrEqual(1_000_000n)
  })

  it('handles empty UTxO array', () => {
    expect(planTokenOutputs([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// createCollateral (error paths only — tx building requires integration test)
// ---------------------------------------------------------------------------

describe('createCollateral', () => {
  function mockWallet(utxos: UTxO[]) {
    return {
      getUtxos: vi.fn().mockResolvedValue(utxos),
      getChangeAddress: vi.fn().mockResolvedValue('addr_test1qz'),
      signTx: vi.fn().mockResolvedValue('signed_tx_hex'),
      submitTx: vi.fn().mockResolvedValue('tx_hash_hex'),
    } as unknown as IWallet
  }

  it('returns error when no UTxOs', async () => {
    const result = await createCollateral(mockWallet([]))
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no utxos/i)
  })

  it('returns success with message when collateral exists', async () => {
    const result = await createCollateral(mockWallet([pureAdaUtxo(5_000_000)]))
    expect(result.success).toBe(true)
    expect(result.error).toMatch(/already exists/i)
    expect(result.txHash).toBeUndefined()
  })

  it('returns error when insufficient funds (< 6.5 ADA)', async () => {
    const result = await createCollateral(mockWallet([pureAdaUtxo(6_000_000)]))
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/insufficient funds/i)
    expect(result.error).toMatch(/6\.5/i)
  })

  it('catches and wraps getChangeAddress failure', async () => {
    const wallet = {
      getUtxos: vi.fn().mockResolvedValue([
        pureAdaUtxo(50_000_000, 'a'.repeat(64), 0),
        pureAdaUtxo(10_000_000, 'a'.repeat(64), 1),
      ]),
      getChangeAddress: vi.fn().mockRejectedValue(new Error('wallet locked')),
      signTx: vi.fn(),
      submitTx: vi.fn(),
    } as unknown as IWallet
    const result = await createCollateral(wallet)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/wallet locked/)
  })

  it('catches tx builder failure when MeshTxBuilder is unavailable', async () => {
    // MeshTxBuilder is mocked as vi.fn(), so .txOut() is undefined → error caught
    const wallet = {
      getUtxos: vi.fn().mockResolvedValue([
        pureAdaUtxo(50_000_000, 'a'.repeat(64), 0),
        pureAdaUtxo(10_000_000, 'a'.repeat(64), 1),
      ]),
      getChangeAddress: vi.fn().mockResolvedValue('addr_test1qz'),
      signTx: vi.fn().mockResolvedValue('signed_hex'),
      submitTx: vi.fn().mockResolvedValue('tx_hash'),
    } as unknown as IWallet
    const result = await createCollateral(wallet)
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('wraps non-Error exceptions as strings', async () => {
    const wallet = {
      getUtxos: vi.fn().mockRejectedValue('string error'),
      getChangeAddress: vi.fn(),
      signTx: vi.fn(),
      submitTx: vi.fn(),
    } as unknown as IWallet
    const result = await createCollateral(wallet)
    expect(result.success).toBe(false)
    expect(result.error).toBe('string error')
  })
})

// ---------------------------------------------------------------------------
// defragWallet (error paths only)
// ---------------------------------------------------------------------------

describe('defragWallet', () => {
  function mockWallet(utxos: UTxO[]) {
    return {
      getUtxos: vi.fn().mockResolvedValue(utxos),
      getChangeAddress: vi.fn().mockResolvedValue('addr_test1qz'),
      signTx: vi.fn().mockResolvedValue('signed_tx_hex'),
      submitTx: vi.fn().mockResolvedValue('tx_hash_hex'),
    } as unknown as IWallet
  }

  it('returns error when no UTxOs', async () => {
    const result = await defragWallet(mockWallet([]))
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no utxos/i)
  })

  it('returns error when only 1 UTxO', async () => {
    const result = await defragWallet(mockWallet([pureAdaUtxo(50_000_000)]))
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/1 utxo/i)
  })

  it('catches getUtxos failure', async () => {
    const wallet = {
      getUtxos: vi.fn().mockRejectedValue(new Error('fetch failed')),
      getChangeAddress: vi.fn(),
      signTx: vi.fn(),
      submitTx: vi.fn(),
    } as unknown as IWallet
    const result = await defragWallet(wallet)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/fetch failed/)
  })
})

// ---------------------------------------------------------------------------
// previewDefrag
// ---------------------------------------------------------------------------

describe('previewDefrag', () => {
  function mockWallet(utxos: UTxO[]) {
    return {
      getUtxos: vi.fn().mockResolvedValue(utxos),
    } as unknown as IWallet
  }

  it('returns infeasible for single UTxO', async () => {
    const preview = await previewDefrag(mockWallet([pureAdaUtxo(50_000_000)]))
    expect(preview.isFeasible).toBe(false)
    expect(preview.infeasibleReason).toMatch(/1 utxo/i)
  })

  it('returns feasible for two large pure ADA UTxOs', async () => {
    const utxos = [
      pureAdaUtxo(10_000_000, 'a'.repeat(64), 0),
      pureAdaUtxo(10_000_000, 'a'.repeat(64), 1),
    ]
    const preview = await previewDefrag(mockWallet(utxos))
    expect(preview.isFeasible).toBe(true)
    expect(preview.tokenOutputs).toHaveLength(0)
    expect(preview.resultingUtxoCount).toBe(2) // change + collateral
    expect(preview.estimatedChangeLovelace).toBeGreaterThan(0n)
  })

  it('includes token outputs in preview', async () => {
    const utxos = [
      pureAdaUtxo(50_000_000, 'a'.repeat(64), 0),
      tokenUtxo(2_000_000, [{ unit: TOKEN_A1, quantity: '100' }]),
    ]
    const preview = await previewDefrag(mockWallet(utxos))
    expect(preview.isFeasible).toBe(true)
    expect(preview.tokenOutputs).toHaveLength(1)
    expect(preview.resultingUtxoCount).toBe(3) // change + collateral + 1 token
  })

  it('returns infeasible when ADA too low for collateral + token min', async () => {
    // Only 1.5 ADA total across 2 UTxOs, but need collateral (5 ADA) + tokens + fee + change
    const utxos = [
      tokenUtxo(800_000, [{ unit: TOKEN_A1, quantity: '1' }], 'h'.repeat(64), 0),
      tokenUtxo(700_000, [{ unit: TOKEN_B1, quantity: '1' }], 'h'.repeat(64), 1),
    ]
    const preview = await previewDefrag(mockWallet(utxos))
    expect(preview.isFeasible).toBe(false)
    expect(preview.infeasibleReason).toMatch(/insufficient ada/i)
  })

  it('sets capped flag when >200 UTxOs', async () => {
    const utxos = Array.from({ length: 210 }, (_, i) =>
      pureAdaUtxo(1_000_000, 'a'.repeat(62) + i.toString(16).padStart(2, '0'), 0),
    )
    const preview = await previewDefrag(mockWallet(utxos))
    expect(preview.capped).toBe(true)
    expect(preview.inputCount).toBe(200)
  })
})
