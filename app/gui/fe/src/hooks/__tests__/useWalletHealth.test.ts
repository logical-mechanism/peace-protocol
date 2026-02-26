import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock the walletManagement module
vi.mock('../../services/walletManagement', () => ({
  analyzeUtxoSet: vi.fn(),
}))

import { useWalletHealth } from '../useWalletHealth'
import { analyzeUtxoSet } from '../../services/walletManagement'
import type { IWallet, UTxO } from '@meshsdk/core'

const mockedAnalyze = vi.mocked(analyzeUtxoSet)

function pureAdaUtxo(lovelace: number): UTxO {
  return {
    input: { txHash: 'a'.repeat(64), outputIndex: 0 },
    output: {
      address: 'addr_test1qz',
      amount: [{ unit: 'lovelace', quantity: String(lovelace) }],
    },
  }
}

function mockWallet(utxos: UTxO[]) {
  return {
    getUtxos: vi.fn().mockResolvedValue(utxos),
    getLovelace: vi.fn(),
    getChangeAddress: vi.fn(),
    getUsedAddresses: vi.fn(),
    getCollateral: vi.fn(),
    signTx: vi.fn(),
    submitTx: vi.fn(),
    signData: vi.fn(),
    getBalance: vi.fn(),
    getNetworkId: vi.fn(),
    getRewardAddresses: vi.fn(),
    getUnusedAddresses: vi.fn(),
    getUsedCollateral: vi.fn(),
    getPolicyIdAssets: vi.fn(),
    getPolicyIds: vi.fn(),
    getAssets: vi.fn(),
  } as unknown as IWallet
}

const HEALTHY_ANALYSIS = {
  hasCollateral: true,
  utxoCount: 2,
  pureAdaCount: 2,
  tokenUtxoCount: 0,
  distinctAssetCount: 0,
  isFragmented: false,
}

const UNHEALTHY_ANALYSIS = {
  hasCollateral: false,
  utxoCount: 15,
  pureAdaCount: 15,
  tokenUtxoCount: 0,
  distinctAssetCount: 0,
  isFragmented: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedAnalyze.mockReturnValue(HEALTHY_ANALYSIS)
})

describe('useWalletHealth', () => {
  it('returns defaults when wallet is null', () => {
    const { result } = renderHook(() =>
      useWalletHealth(null, 100, 'synced'),
    )
    expect(result.current.hasCollateral).toBe(false)
    expect(result.current.utxoCount).toBe(0)
    expect(result.current.isChecking).toBe(false)
    expect(result.current.utxos).toEqual([])
  })

  it('returns defaults when nodeStage is not synced', () => {
    const wallet = mockWallet([pureAdaUtxo(5_000_000)])
    const { result } = renderHook(() =>
      useWalletHealth(wallet, 100, 'syncing'),
    )
    expect(result.current.hasCollateral).toBe(false)
    expect(result.current.utxoCount).toBe(0)
    expect(wallet.getUtxos).not.toHaveBeenCalled()
  })

  it('returns defaults when tipSlot is null', () => {
    const wallet = mockWallet([pureAdaUtxo(5_000_000)])
    renderHook(() =>
      useWalletHealth(wallet, null, 'synced'),
    )
    expect(wallet.getUtxos).not.toHaveBeenCalled()
  })

  it('checks wallet health when synced with valid tipSlot', async () => {
    const utxos = [pureAdaUtxo(5_000_000)]
    const wallet = mockWallet(utxos)

    const { result } = renderHook(() =>
      useWalletHealth(wallet, 100, 'synced'),
    )

    // Wait for async check to complete
    await vi.waitFor(() => {
      expect(result.current.hasCollateral).toBe(true)
    })

    expect(wallet.getUtxos).toHaveBeenCalledTimes(1)
    expect(mockedAnalyze).toHaveBeenCalledWith(utxos)
    expect(result.current.utxoCount).toBe(2)
    expect(result.current.isFragmented).toBe(false)
    expect(result.current.isChecking).toBe(false)
  })

  it('detects unhealthy wallet', async () => {
    mockedAnalyze.mockReturnValue(UNHEALTHY_ANALYSIS)
    const wallet = mockWallet([pureAdaUtxo(1_000_000)])

    const { result } = renderHook(() =>
      useWalletHealth(wallet, 100, 'synced'),
    )

    // Wait for the async check to fully complete (utxoCount updates from 0 → 15)
    await vi.waitFor(() => {
      expect(result.current.utxoCount).toBe(15)
    })

    expect(result.current.hasCollateral).toBe(false)
    expect(result.current.isFragmented).toBe(true)
    expect(result.current.needsDefrag).toBe(true)
  })

  it('re-checks when tipSlot changes after recheck bypasses throttle', async () => {
    const wallet = mockWallet([pureAdaUtxo(5_000_000)])

    const { result } = renderHook(
      ({ tipSlot }) => useWalletHealth(wallet, tipSlot, 'synced'),
      { initialProps: { tipSlot: 100 } },
    )

    await vi.waitFor(() => {
      expect(result.current.hasCollateral).toBe(true)
    })

    const callsAfterFirst = wallet.getUtxos.mock.calls.length

    // recheck() bypasses throttle and triggers immediately
    await act(async () => {
      result.current.recheck()
    })

    expect(wallet.getUtxos).toHaveBeenCalledTimes(callsAfterFirst + 1)
  })

  it('recheck() bypasses throttle', async () => {
    const wallet = mockWallet([pureAdaUtxo(5_000_000)])

    const { result } = renderHook(() =>
      useWalletHealth(wallet, 100, 'synced'),
    )

    await vi.waitFor(() => {
      expect(wallet.getUtxos).toHaveBeenCalledTimes(1)
    })

    // Immediate recheck should bypass throttle
    await act(async () => {
      result.current.recheck()
    })

    expect(wallet.getUtxos).toHaveBeenCalledTimes(2)
  })

  it('handles getUtxos error gracefully', async () => {
    const wallet = mockWallet([])
    wallet.getUtxos.mockRejectedValueOnce(new Error('Kupo unavailable'))

    const { result } = renderHook(() =>
      useWalletHealth(wallet, 100, 'synced'),
    )

    await vi.waitFor(() => {
      expect(result.current.isChecking).toBe(false)
    })

    // Should preserve defaults, not crash
    expect(result.current.hasCollateral).toBe(false)
    expect(result.current.utxoCount).toBe(0)
  })

  it('caches utxos for external use', async () => {
    const utxos = [pureAdaUtxo(5_000_000), pureAdaUtxo(10_000_000)]
    const wallet = mockWallet(utxos)

    const { result } = renderHook(() =>
      useWalletHealth(wallet, 100, 'synced'),
    )

    await vi.waitFor(() => {
      expect(result.current.utxos).toHaveLength(2)
    })
  })
})
