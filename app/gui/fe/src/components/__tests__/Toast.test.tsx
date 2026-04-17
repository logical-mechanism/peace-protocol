import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useToast, ToastContainer, type ToastMessage } from '../Toast'

vi.mock('../../utils/network', () => ({
  getTransactionUrl: (hash: string) => `https://cardanoscan.io/transaction/${hash}`,
  isValidTxHash: (hash: string) => /^[0-9a-f]{64}$/.test(hash),
}))

vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}))

const { copyToClipboard } = await import('../../utils/clipboard')

vi.mock('../../services/toastSettings', () => ({
  getToastDurationMs: () => 5000,
}))

vi.mock('../../services/transactionHistory', () => ({
  getTypeLabelKey: (type: string) => `history.txType.${type}`,
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

  it('error() passes action through to the toast', () => {
    const { result } = renderHook(() => useToast())
    const onClick = vi.fn()

    act(() => {
      result.current.error('Tx Failed', 'Insufficient funds', 0, { label: 'Retry', onClick })
    })

    expect(result.current.toasts).toHaveLength(1)
    const toast = result.current.toasts[0]
    expect(toast.type).toBe('error')
    expect(toast.duration).toBe(0)
    expect(toast.action).toBeDefined()
    expect(toast.action?.label).toBe('Retry')
    expect(toast.action?.onClick).toBe(onClick)
  })

  it('warning() passes action through to the toast', () => {
    const { result } = renderHook(() => useToast())
    const onClick = vi.fn()

    act(() => {
      result.current.warning('Caution', 'Check something', undefined, { label: 'Fix', onClick })
    })

    expect(result.current.toasts).toHaveLength(1)
    const toast = result.current.toasts[0]
    expect(toast.type).toBe('warning')
    expect(toast.action?.label).toBe('Fix')
    expect(toast.action?.onClick).toBe(onClick)
  })

  it('success() passes action through to the toast', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.success('Done', 'All good', undefined, { label: 'View', href: 'https://example.com' })
    })

    expect(result.current.toasts[0].action?.label).toBe('View')
    expect(result.current.toasts[0].action?.href).toBe('https://example.com')
  })

  it('info() passes action through to the toast', () => {
    const { result } = renderHook(() => useToast())
    const onClick = vi.fn()

    act(() => {
      result.current.info('Note', 'FYI', undefined, { label: 'Details', onClick })
    })

    expect(result.current.toasts[0].action?.label).toBe('Details')
  })

  it('convenience methods work without action (backward compat)', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.error('Fail')
      result.current.warning('Warn')
      result.current.success('OK')
    })

    expect(result.current.toasts[0].action).toBeUndefined()
    expect(result.current.toasts[1].action).toBeUndefined()
    expect(result.current.toasts[2].action).toBeUndefined()
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

  it('transactionSuccess passes secondary action through', () => {
    const { result } = renderHook(() => useToast())
    const validHash = 'c'.repeat(64)
    const onClick = vi.fn()

    act(() => {
      result.current.transactionSuccess('Bid Placed!', validHash, { type: 'place-bid' }, { label: 'View History', onClick })
    })

    const toast = result.current.toasts[0]
    expect(toast.action?.label).toBe('View on CardanoScan')
    expect(toast.secondaryAction).toBeDefined()
    expect(toast.secondaryAction?.label).toBe('View History')
    expect(toast.secondaryAction?.onClick).toBe(onClick)
  })
})

describe('Toast secondary action rendering', () => {
  const mockOnClose = vi.fn()

  it('renders both primary and secondary actions', () => {
    const onClick = vi.fn()
    const toasts: ToastMessage[] = [{
      id: '1',
      type: 'success',
      title: 'Test',
      duration: 0,
      action: { label: 'View on CardanoScan', href: 'https://example.com' },
      secondaryAction: { label: 'View History', onClick },
    }]
    render(<ToastContainer toasts={toasts} onClose={mockOnClose} />)

    expect(screen.getByText('View on CardanoScan')).toBeInTheDocument()
    expect(screen.getByText('View History')).toBeInTheDocument()
  })

  it('secondary action onClick fires when clicked', () => {
    const onClick = vi.fn()
    const toasts: ToastMessage[] = [{
      id: '1',
      type: 'success',
      title: 'Test',
      duration: 0,
      secondaryAction: { label: 'View History', onClick },
    }]
    render(<ToastContainer toasts={toasts} onClose={mockOnClose} />)

    fireEvent.click(screen.getByText('View History'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('Toast stagger animation', () => {
  const mockOnClose = vi.fn()

  it('applies staggered animation delay to concurrent toasts', () => {
    const toasts: ToastMessage[] = [
      { id: '1', type: 'success', title: 'Toast 1', duration: 0 },
      { id: '2', type: 'info', title: 'Toast 2', duration: 0 },
      { id: '3', type: 'warning', title: 'Toast 3', duration: 0 },
    ]
    render(<ToastContainer toasts={toasts} onClose={mockOnClose} />)
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(3)
    // First toast has no delay
    expect(alerts[0].style.animationDelay).toBe('')
    // Subsequent toasts get incremental 50ms delays
    expect(alerts[1].style.animationDelay).toBe('50ms')
    expect(alerts[2].style.animationDelay).toBe('100ms')
  })

  it('applies animation-fill-mode backwards for staggered toasts', () => {
    const toasts: ToastMessage[] = [
      { id: '1', type: 'success', title: 'Toast 1', duration: 0 },
      { id: '2', type: 'info', title: 'Toast 2', duration: 0 },
    ]
    render(<ToastContainer toasts={toasts} onClose={mockOnClose} />)
    const alerts = screen.getAllByRole('alert')
    // First toast: no fill mode override
    expect(alerts[0].style.animationFillMode).toBe('')
    // Second toast: backwards fill mode so it stays hidden during delay
    expect(alerts[1].style.animationFillMode).toBe('backwards')
  })
})

describe('Toast copy button', () => {
  const mockOnClose = vi.fn()

  function renderToasts(toasts: ToastMessage[]) {
    return render(<ToastContainer toasts={toasts} onClose={mockOnClose} />)
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows copy button for error toasts', () => {
    renderToasts([{ id: '1', type: 'error', title: 'Fail', message: 'Details', duration: 0 }])
    expect(screen.getByLabelText('Copy error to clipboard')).toBeInTheDocument()
  })

  it('shows copy button for warning toasts', () => {
    renderToasts([{ id: '1', type: 'warning', title: 'Warn', message: 'Details', duration: 0 }])
    expect(screen.getByLabelText('Copy error to clipboard')).toBeInTheDocument()
  })

  it('does not show copy button for success toasts', () => {
    renderToasts([{ id: '1', type: 'success', title: 'OK', message: 'Details', duration: 0 }])
    expect(screen.queryByLabelText('Copy error to clipboard')).not.toBeInTheDocument()
  })

  it('does not show copy button for info toasts', () => {
    renderToasts([{ id: '1', type: 'info', title: 'FYI', message: 'Details', duration: 0 }])
    expect(screen.queryByLabelText('Copy error to clipboard')).not.toBeInTheDocument()
  })

  it('copies title and message to clipboard on click', async () => {
    renderToasts([{ id: '1', type: 'error', title: 'Network Error', message: 'Failed to fetch', duration: 0 }])
    fireEvent.click(screen.getByLabelText('Copy error to clipboard'))
    await waitFor(() => {
      expect(copyToClipboard).toHaveBeenCalledWith('Network Error: Failed to fetch')
    })
  })

  it('copies only title when no message', async () => {
    renderToasts([{ id: '1', type: 'error', title: 'Network Error', duration: 0 }])
    fireEvent.click(screen.getByLabelText('Copy error to clipboard'))
    await waitFor(() => {
      expect(copyToClipboard).toHaveBeenCalledWith('Network Error')
    })
  })
})

describe('Toast transaction celebration', () => {
  it('transactionSuccess sets variant to transaction', () => {
    const { result } = renderHook(() => useToast())
    const validHash = 'c'.repeat(64)

    act(() => {
      result.current.transactionSuccess('Sale Complete!', validHash)
    })

    expect(result.current.toasts[0].variant).toBe('transaction')
  })

  it('regular success does not set variant', () => {
    const { result } = renderHook(() => useToast())

    act(() => {
      result.current.success('Done')
    })

    expect(result.current.toasts[0].variant).toBeUndefined()
  })

  it('applies tx-celebration class to transaction success icon', () => {
    const toasts: ToastMessage[] = [
      { id: '1', type: 'success', title: 'Sale!', duration: 0, variant: 'transaction' },
    ]
    render(<ToastContainer toasts={toasts} onClose={vi.fn()} />)
    const alert = screen.getByRole('alert')
    expect(alert.querySelector('.tx-celebration')).toBeInTheDocument()
  })

  it('does not apply tx-celebration class to regular success', () => {
    const toasts: ToastMessage[] = [
      { id: '1', type: 'success', title: 'OK', duration: 0 },
    ]
    render(<ToastContainer toasts={toasts} onClose={vi.fn()} />)
    const alert = screen.getByRole('alert')
    expect(alert.querySelector('.tx-celebration')).not.toBeInTheDocument()
  })
})
