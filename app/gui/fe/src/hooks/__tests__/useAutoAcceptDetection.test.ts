import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAutoAcceptDetection } from '../useAutoAcceptDetection'

vi.mock('../../services/api', () => ({
  encryptionsApi: {
    getAll: vi.fn(),
  },
  bidsApi: {
    getAll: vi.fn(),
  },
}))

import { encryptionsApi, bidsApi } from '../../services/api'
import type { EncryptionDisplay, BidDisplay } from '../../services/api'

function makeEncryption(overrides: Partial<EncryptionDisplay> = {}): EncryptionDisplay {
  return {
    tokenName: 'enc1',
    sellerPkh: 'pkh1',
    status: 'active',
    suggestedPrice: 5_000_000,
    createdAt: '2024-01-01T00:00:00Z',
    utxo: { txHash: 'tx1', outputIndex: 0 },
    datum: {
      owner_vkh: 'pkh1',
      owner_g1: { generator: '', public_value: '' },
      token: 'enc1',
      half_level: { r1b: '', r2_g1b: '', r4b: '' },
      full_level: null,
      capsule: { nonce: '', aad: '', ct: '' },
      status: { type: 'Open' },
      new_price: 5_000_000,
    },
    ...overrides,
  }
}

function makeBid(overrides: Partial<BidDisplay> = {}): BidDisplay {
  return {
    tokenName: 'bid1',
    bidder: 'addr2',
    bidderPkh: 'pkh2',
    encryptionToken: 'enc1',
    amount: 5_000_000,
    status: 'pending',
    createdAt: '2024-01-01T00:00:00Z',
    lockedUntil: 0,
    utxo: { txHash: 'tx2', outputIndex: 0 },
    datum: {
      owner_vkh: 'pkh2',
      owner_g1: { generator: '', public_value: '' },
      pointer: 'bid1',
      token: 'enc1',
      locked_until: 0,
      new_price: 0,
    },
    ...overrides,
  }
}

describe('useAutoAcceptDetection', () => {
  const mockEnqueue = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockEnqueue.mockReturnValue('queue-id')
  })

  it('does nothing when auto-accept is disabled', () => {
    renderHook(() =>
      useAutoAcceptDetection({
        userPkh: 'pkh1',
        autoAcceptEnabled: false,
        tipSlot: 100,
        nodeStage: 'synced',
        enqueue: mockEnqueue,
      })
    )
    expect(encryptionsApi.getAll).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('does nothing when node is not synced', () => {
    renderHook(() =>
      useAutoAcceptDetection({
        userPkh: 'pkh1',
        autoAcceptEnabled: true,
        tipSlot: 100,
        nodeStage: 'syncing',
        enqueue: mockEnqueue,
      })
    )
    expect(encryptionsApi.getAll).not.toHaveBeenCalled()
  })

  it('does nothing when userPkh is undefined', () => {
    renderHook(() =>
      useAutoAcceptDetection({
        userPkh: undefined,
        autoAcceptEnabled: true,
        tipSlot: 100,
        nodeStage: 'synced',
        enqueue: mockEnqueue,
      })
    )
    expect(encryptionsApi.getAll).not.toHaveBeenCalled()
  })

  it('enqueues eligible bids when auto-accept is enabled', async () => {
    const enc = makeEncryption({ tokenName: 'enc1', suggestedPrice: 5_000_000 })
    const bid = makeBid({ tokenName: 'bid1', encryptionToken: 'enc1', amount: 5_000_000 })

    vi.mocked(encryptionsApi.getAll).mockResolvedValue([enc])
    vi.mocked(bidsApi.getAll).mockResolvedValue([bid])

    renderHook(() =>
      useAutoAcceptDetection({
        userPkh: 'pkh1',
        autoAcceptEnabled: true,
        tipSlot: 100,
        nodeStage: 'synced',
        enqueue: mockEnqueue,
      })
    )

    // Wait for async effect
    await vi.waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledWith(enc, bid, false)
    })
  })

  it('does not enqueue bids below suggested price', async () => {
    const enc = makeEncryption({ tokenName: 'enc1', suggestedPrice: 10_000_000 })
    const bid = makeBid({ tokenName: 'bid1', encryptionToken: 'enc1', amount: 5_000_000 })

    vi.mocked(encryptionsApi.getAll).mockResolvedValue([enc])
    vi.mocked(bidsApi.getAll).mockResolvedValue([bid])

    renderHook(() =>
      useAutoAcceptDetection({
        userPkh: 'pkh1',
        autoAcceptEnabled: true,
        tipSlot: 100,
        nodeStage: 'synced',
        enqueue: mockEnqueue,
      })
    )

    // Wait for async effect to finish
    await vi.waitFor(() => {
      expect(encryptionsApi.getAll).toHaveBeenCalled()
    })

    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('selects oldest eligible bid when multiple exist', async () => {
    const enc = makeEncryption({ tokenName: 'enc1', suggestedPrice: 5_000_000 })
    const olderBid = makeBid({
      tokenName: 'bid1', encryptionToken: 'enc1', amount: 5_000_000,
      createdAt: '2024-01-01T00:00:00Z',
    })
    const newerBid = makeBid({
      tokenName: 'bid2', encryptionToken: 'enc1', amount: 10_000_000,
      createdAt: '2024-01-02T00:00:00Z',
    })

    vi.mocked(encryptionsApi.getAll).mockResolvedValue([enc])
    vi.mocked(bidsApi.getAll).mockResolvedValue([newerBid, olderBid])

    renderHook(() =>
      useAutoAcceptDetection({
        userPkh: 'pkh1',
        autoAcceptEnabled: true,
        tipSlot: 100,
        nodeStage: 'synced',
        enqueue: mockEnqueue,
      })
    )

    await vi.waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledWith(enc, olderBid, false)
    })

    // Should only enqueue once per encryption
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
  })
})
