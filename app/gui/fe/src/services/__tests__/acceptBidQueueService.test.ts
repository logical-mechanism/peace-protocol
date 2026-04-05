import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { EncryptionDisplay, BidDisplay } from '../api'

// Mock external dependencies before importing the service
vi.mock('../api', () => ({
  encryptionsApi: {
    getByToken: vi.fn(),
  },
  bidsApi: {
    getByEncryption: vi.fn(),
  },
}))

vi.mock('../transactions/acceptBid', () => ({
  prepareSnarkInputs: vi.fn(),
  acceptBidAndReEncrypt: vi.fn(),
}))

vi.mock('../snark', () => ({
  getSnarkProver: vi.fn(() => ({
    generateProof: vi.fn(),
  })),
}))

vi.mock('../optimisticStore', () => ({
  optimisticStore: {
    updateEncryption: vi.fn(),
  },
}))

vi.mock('../acceptBidQueueStorage', () => ({
  getAutoAcceptEnabled: vi.fn(() => false),
  setAutoAcceptEnabled: vi.fn(),
  getPersistedQueue: vi.fn(() => []),
  setPersistedQueue: vi.fn(),
}))

import { AcceptBidQueueService, type ProcessingDeps } from '../acceptBidQueueService'

function makeEncryption(overrides: Partial<EncryptionDisplay> = {}): EncryptionDisplay {
  return {
    tokenName: 'enc1',
    seller: 'addr1',
    sellerPkh: 'pkh1',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    suggestedPrice: 5_000_000,
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

function makeDeps(overrides: Partial<ProcessingDeps> = {}): ProcessingDeps {
  return {
    wallet: {} as ProcessingDeps['wallet'],
    toast: {
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      transactionSuccess: vi.fn(),
    },
    recordTransaction: vi.fn(),
    triggerTransactionRefresh: vi.fn(),
    ...overrides,
  }
}

describe('AcceptBidQueueService', () => {
  let service: AcceptBidQueueService

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    service = new AcceptBidQueueService()
  })

  describe('enqueue', () => {
    it('adds an item and returns its id', () => {
      const id = service.enqueue(makeEncryption(), makeBid(), false)
      expect(id).toBeTruthy()
      expect(service.getQueue()).toHaveLength(1)
      expect(service.getQueue()[0].status).toBe('queued')
    })

    it('returns null for duplicate encryption token', () => {
      service.enqueue(makeEncryption(), makeBid(), false)
      const id2 = service.enqueue(makeEncryption(), makeBid({ tokenName: 'bid2' }), false)
      expect(id2).toBeNull()
      expect(service.getQueue()).toHaveLength(1)
    })

    it('allows different encryption tokens', () => {
      service.enqueue(makeEncryption({ tokenName: 'enc1' }), makeBid(), false)
      const id2 = service.enqueue(
        makeEncryption({ tokenName: 'enc2' }),
        makeBid({ tokenName: 'bid2', encryptionToken: 'enc2' }),
        false,
      )
      expect(id2).toBeTruthy()
      expect(service.getQueue()).toHaveLength(2)
    })

    it('priority items are inserted at the front', () => {
      service.enqueue(makeEncryption({ tokenName: 'enc1' }), makeBid({ tokenName: 'bid1' }), false)
      service.enqueue(makeEncryption({ tokenName: 'enc2' }), makeBid({ tokenName: 'bid2' }), true)

      const queue = service.getQueue()
      expect(queue[0].bid.tokenName).toBe('bid2')
      expect(queue[1].bid.tokenName).toBe('bid1')
    })

    it('emits change event', () => {
      const listener = vi.fn()
      service.on('change', listener)
      service.enqueue(makeEncryption(), makeBid(), false)
      expect(listener).toHaveBeenCalled()
    })
  })

  describe('remove', () => {
    it('removes a queued item', () => {
      const id = service.enqueue(makeEncryption(), makeBid(), false)!
      expect(service.remove(id)).toBe(true)
      expect(service.getQueue()).toHaveLength(0)
    })

    it('returns false for non-existent id', () => {
      expect(service.remove('nonexistent')).toBe(false)
    })

    it('clears the encryption token from the dedup set', () => {
      const id = service.enqueue(makeEncryption(), makeBid(), false)!
      service.remove(id)
      // Can now add the same encryption again
      const id2 = service.enqueue(makeEncryption(), makeBid(), false)
      expect(id2).toBeTruthy()
    })
  })

  describe('retry', () => {
    it('resets a failed item to queued at the front', () => {
      // Add two items
      service.enqueue(makeEncryption({ tokenName: 'enc1' }), makeBid({ tokenName: 'bid1' }), false)
      const id2 = service.enqueue(
        makeEncryption({ tokenName: 'enc2' }),
        makeBid({ tokenName: 'bid2', encryptionToken: 'enc2' }),
        false,
      )!

      // Manually mark second item as failed
      const queue = service.getQueue()
      const item = queue.find(i => i.id === id2)!
      ;(item as { status: string }).status = 'failed'
      ;(item as { error: string }).error = 'test error'

      // Retry should move to front and reset
      expect(service.retry(id2)).toBe(true)
      const updated = service.getQueue()
      expect(updated[0].id).toBe(id2)
      expect(updated[0].status).toBe('queued')
      expect(updated[0].error).toBeUndefined()
    })

    it('returns false for non-failed items', () => {
      const id = service.enqueue(makeEncryption(), makeBid(), false)!
      expect(service.retry(id)).toBe(false)
    })
  })

  describe('clear', () => {
    it('removes all queued items', () => {
      service.enqueue(makeEncryption({ tokenName: 'enc1' }), makeBid({ tokenName: 'bid1' }), false)
      service.enqueue(makeEncryption({ tokenName: 'enc2' }), makeBid({ tokenName: 'bid2' }), false)
      service.clear()
      expect(service.getQueue()).toHaveLength(0)
    })
  })

  describe('auto-accept', () => {
    it('defaults to false', () => {
      expect(service.getAutoAcceptEnabled()).toBe(false)
    })

    it('can be toggled and emits change', () => {
      const listener = vi.fn()
      service.on('change', listener)
      service.setAutoAccept(true)
      expect(service.getAutoAcceptEnabled()).toBe(true)
      expect(listener).toHaveBeenCalled()
    })
  })

  describe('hasEncryptionInQueue', () => {
    it('returns true when encryption is queued', () => {
      service.enqueue(makeEncryption({ tokenName: 'enc1' }), makeBid(), false)
      expect(service.hasEncryptionInQueue('enc1')).toBe(true)
      expect(service.hasEncryptionInQueue('enc2')).toBe(false)
    })
  })

  describe('processing', () => {
    it('isProcessing returns false initially', () => {
      expect(service.isProcessing()).toBe(false)
    })

    it('getCurrentItem returns null when not processing', () => {
      service.enqueue(makeEncryption(), makeBid(), false)
      expect(service.getCurrentItem()).toBeNull()
    })
  })
})
