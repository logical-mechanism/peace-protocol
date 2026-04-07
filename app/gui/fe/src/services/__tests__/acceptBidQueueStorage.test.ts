import { describe, it, expect, beforeEach } from 'vitest'
import {
  getAutoAcceptEnabled, setAutoAcceptEnabled,
  getPersistedQueue, setPersistedQueue,
  type SerializedQueueItem,
} from '../acceptBidQueueStorage'

beforeEach(() => {
  localStorage.clear()
})

describe('acceptBidQueueStorage', () => {
  describe('auto-accept flag', () => {
    it('defaults to false', () => {
      expect(getAutoAcceptEnabled()).toBe(false)
    })

    it('roundtrips true', () => {
      setAutoAcceptEnabled(true)
      expect(getAutoAcceptEnabled()).toBe(true)
    })

    it('roundtrips false after being set to true', () => {
      setAutoAcceptEnabled(true)
      setAutoAcceptEnabled(false)
      expect(getAutoAcceptEnabled()).toBe(false)
    })
  })

  describe('persisted queue', () => {
    it('returns empty array when nothing stored', () => {
      expect(getPersistedQueue()).toEqual([])
    })

    it('roundtrips queue items', () => {
      const items: SerializedQueueItem[] = [
        {
          id: 'q1',
          encryptionTokenName: 'enc1',
          bidTokenName: 'bid1',
          status: 'queued',
          priority: false,
          addedAt: 1000,
        },
        {
          id: 'q2',
          encryptionTokenName: 'enc2',
          bidTokenName: 'bid2',
          status: 'failed',
          priority: true,
          error: 'Some error',
          addedAt: 2000,
          completedAt: 3000,
        },
      ]
      setPersistedQueue(items)
      expect(getPersistedQueue()).toEqual(items)
    })

    it('resets in-progress items to failed on load', () => {
      const items: SerializedQueueItem[] = [
        { id: 'q1', encryptionTokenName: 'e1', bidTokenName: 'b1', status: 'preparing', priority: false, addedAt: 1 },
        { id: 'q2', encryptionTokenName: 'e2', bidTokenName: 'b2', status: 'proving', priority: false, addedAt: 2 },
        { id: 'q3', encryptionTokenName: 'e3', bidTokenName: 'b3', status: 'submitting', priority: true, addedAt: 3 },
        { id: 'q4', encryptionTokenName: 'e4', bidTokenName: 'b4', status: 'queued', priority: false, addedAt: 4 },
        { id: 'q5', encryptionTokenName: 'e5', bidTokenName: 'b5', status: 'failed', priority: false, addedAt: 5, error: 'old error' },
      ]
      setPersistedQueue(items)

      const loaded = getPersistedQueue()
      expect(loaded[0].status).toBe('failed')
      expect(loaded[0].error).toBe('Interrupted by app restart')
      expect(loaded[1].status).toBe('failed')
      expect(loaded[1].error).toBe('Interrupted by app restart')
      expect(loaded[2].status).toBe('failed')
      expect(loaded[2].error).toBe('Interrupted by app restart')
      // Queued stays queued
      expect(loaded[3].status).toBe('queued')
      // Already failed stays failed with original error
      expect(loaded[4].status).toBe('failed')
      expect(loaded[4].error).toBe('old error')
    })

    it('persists the reset back to localStorage', () => {
      const items: SerializedQueueItem[] = [
        { id: 'q1', encryptionTokenName: 'e1', bidTokenName: 'b1', status: 'proving', priority: false, addedAt: 1 },
      ]
      setPersistedQueue(items)

      // First load resets
      getPersistedQueue()

      // Second load should also see the reset (it was persisted)
      const secondLoad = getPersistedQueue()
      expect(secondLoad[0].status).toBe('failed')
    })
  })
})
