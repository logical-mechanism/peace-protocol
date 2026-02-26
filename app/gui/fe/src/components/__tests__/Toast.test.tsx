import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useToast } from '../Toast'

vi.mock('../../utils/network', () => ({
  getTransactionUrl: (hash: string) => `https://cardanoscan.io/transaction/${hash}`,
  isValidTxHash: (hash: string) => /^[0-9a-f]{64}$/.test(hash),
}))

vi.mock('../../services/toastSettings', () => ({
  getToastDurationMs: () => 5000,
}))

vi.mock('../../services/transactionHistory', () => ({
  getTypeLabel: (type: string) => {
    const labels: Record<string, string> = {
      'create-listing': 'Create Listing',
      'remove-listing': 'Remove Listing',
      'place-bid': 'Place Bid',
      'cancel-bid': 'Cancel Bid',
      'accept-bid': 'Accept Bid',
      'cancel-pending': 'Cancel Pending',
      'complete-sale': 'Complete Sale',
    }
    return labels[type] || type
  },
}))

describe('useToast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds up to 3 visible toasts', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.success('Toast 1')
      result.current.success('Toast 2')
      result.current.success('Toast 3')
    })

    expect(result.current.toasts).toHaveLength(3)
  })

  it('queues the 4th toast when 3 are visible', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.success('Toast 1')
      result.current.success('Toast 2')
      result.current.success('Toast 3')
      result.current.success('Toast 4')
    })

    expect(result.current.toasts).toHaveLength(3)
    expect(result.current.toasts.map(t => t.title)).toEqual(['Toast 1', 'Toast 2', 'Toast 3'])
  })

  it('promotes from queue when a visible toast is removed', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.success('Toast 1')
      result.current.success('Toast 2')
      result.current.success('Toast 3')
      result.current.success('Toast 4')
    })

    const firstId = result.current.toasts[0].id

    act(() => {
      result.current.removeToast(firstId)
    })

    expect(result.current.toasts).toHaveLength(3)
    expect(result.current.toasts.map(t => t.title)).toEqual(['Toast 2', 'Toast 3', 'Toast 4'])
  })

  it('promotes multiple from queue when multiple slots open', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.success('Toast 1')
      result.current.success('Toast 2')
      result.current.success('Toast 3')
      result.current.success('Toast 4')
      result.current.success('Toast 5')
    })

    // Remove two visible toasts
    const id1 = result.current.toasts[0].id
    const id2 = result.current.toasts[1].id

    act(() => {
      result.current.removeToast(id1)
    })
    act(() => {
      result.current.removeToast(id2)
    })

    expect(result.current.toasts).toHaveLength(3)
    expect(result.current.toasts.map(t => t.title)).toEqual(['Toast 3', 'Toast 4', 'Toast 5'])
  })

  it('dismissAll clears visible toasts and queue', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.success('Toast 1')
      result.current.success('Toast 2')
      result.current.success('Toast 3')
      result.current.success('Toast 4')
      result.current.success('Toast 5')
    })

    expect(result.current.toasts).toHaveLength(3)

    act(() => {
      result.current.dismissAll()
    })

    expect(result.current.toasts).toHaveLength(0)

    // Adding new toasts should work after dismissAll
    act(() => {
      result.current.success('New Toast')
    })
    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].title).toBe('New Toast')
  })

  it('handles removing a non-existent toast gracefully', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.success('Toast 1')
    })

    act(() => {
      result.current.removeToast('nonexistent-id')
    })

    expect(result.current.toasts).toHaveLength(1)
  })

  it('creates toasts with correct types', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.success('S', 'success msg')
      result.current.error('E', 'error msg')
      result.current.warning('W', 'warning msg')
    })

    expect(result.current.toasts[0].type).toBe('success')
    expect(result.current.toasts[1].type).toBe('error')
    expect(result.current.toasts[2].type).toBe('warning')
  })

  it('info toast goes to queue when at capacity', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.success('Toast 1')
      result.current.error('Toast 2')
      result.current.warning('Toast 3')
      result.current.info('Toast 4')
    })

    expect(result.current.toasts).toHaveLength(3)

    // Remove one to promote the info toast
    act(() => {
      result.current.removeToast(result.current.toasts[0].id)
    })

    expect(result.current.toasts).toHaveLength(3)
    expect(result.current.toasts[2].type).toBe('info')
    expect(result.current.toasts[2].title).toBe('Toast 4')
  })

  it('transactionSuccess creates success toast with CardanoScan link', () => {
    const { result } = renderHook(() => useToast())
    const validHash = 'a'.repeat(64)

    act(() => {
      result.current.transactionSuccess('Bid Placed!', validHash)
    })

    expect(result.current.toasts).toHaveLength(1)
    const toast = result.current.toasts[0]
    expect(toast.type).toBe('success')
    expect(toast.title).toBe('Bid Placed!')
    expect(toast.action).toBeDefined()
    expect(toast.action?.label).toBe('View on CardanoScan')
    expect(toast.action?.href).toContain(validHash)
  })

  it('transactionSuccess with invalid hash has no action', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.transactionSuccess('Test', 'invalid-hash')
    })

    expect(result.current.toasts[0].action).toBeUndefined()
  })

  it('addToast returns unique ids', () => {
    const { result } = renderHook(() => useToast())
    const ids: string[] = []

    act(() => {
      ids.push(result.current.success('Toast 1'))
      ids.push(result.current.success('Toast 2'))
      ids.push(result.current.success('Toast 3'))
    })

    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(3)
  })

  it('queue order is FIFO', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.success('Visible 1')
      result.current.success('Visible 2')
      result.current.success('Visible 3')
      result.current.success('Queued A')
      result.current.success('Queued B')
      result.current.success('Queued C')
    })

    // Remove all 3 visible
    act(() => { result.current.removeToast(result.current.toasts[0].id) })
    act(() => { result.current.removeToast(result.current.toasts[0].id) })
    act(() => { result.current.removeToast(result.current.toasts[0].id) })

    expect(result.current.toasts.map(t => t.title)).toEqual(['Queued A', 'Queued B', 'Queued C'])
  })

  describe('transactionSuccess with details', () => {
    const validHash = 'b'.repeat(64)

    it('backward compat: plain string message works', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.transactionSuccess('Test', validHash, 'Custom message')
      })

      expect(result.current.toasts[0].message).toBe('Custom message')
    })

    it('backward compat: no third arg shows hash preview', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.transactionSuccess('Test', validHash)
      })

      expect(result.current.toasts[0].message).toContain('Transaction:')
      expect(result.current.toasts[0].message).toContain(validHash.slice(0, 16))
    })

    it('shows type label when TransactionDetails has type', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.transactionSuccess('Bid Placed!', validHash, { type: 'place-bid' })
      })

      expect(result.current.toasts[0].message).toContain('Place Bid')
    })

    it('shows formatted ADA amount when TransactionDetails has amountLovelace', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.transactionSuccess('Bid Placed!', validHash, {
          type: 'place-bid',
          amountLovelace: 50_000_000,
        })
      })

      const msg = result.current.toasts[0].message!
      expect(msg).toContain('Place Bid')
      expect(msg).toContain('50')
      expect(msg).toContain('ADA')
    })

    it('shows only type when amount is zero', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.transactionSuccess('Test', validHash, {
          type: 'remove-listing',
          amountLovelace: 0,
        })
      })

      expect(result.current.toasts[0].message).toBe('Remove Listing')
    })

    it('shows custom message from details', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.transactionSuccess('Test', validHash, {
          message: 'Extra info',
        })
      })

      expect(result.current.toasts[0].message).toBe('Extra info')
    })

    it('combines type, amount, and message with em-dash separator', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.transactionSuccess('Test', validHash, {
          type: 'accept-bid',
          amountLovelace: 100_000_000,
          message: 'SNARK proof',
        })
      })

      const msg = result.current.toasts[0].message!
      expect(msg).toContain('Accept Bid')
      expect(msg).toContain('100')
      expect(msg).toContain('ADA')
      expect(msg).toContain('SNARK proof')
      expect(msg).toContain('\u2014') // em-dash separator
    })

    it('falls back to hash preview when details object is empty', () => {
      const { result } = renderHook(() => useToast())

      act(() => {
        result.current.transactionSuccess('Test', validHash, {})
      })

      expect(result.current.toasts[0].message).toContain('Transaction:')
    })
  })
})
