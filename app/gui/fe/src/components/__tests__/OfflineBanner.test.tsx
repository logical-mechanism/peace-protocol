import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import OfflineBanner from '../OfflineBanner'

let listeners: Record<string, Set<EventListener>>

beforeEach(() => {
  listeners = { offline: new Set(), online: new Set() }

  vi.spyOn(window, 'addEventListener').mockImplementation((type, handler) => {
    listeners[type]?.add(handler as EventListener)
  })
  vi.spyOn(window, 'removeEventListener').mockImplementation((type, handler) => {
    listeners[type]?.delete(handler as EventListener)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function fireWindowEvent(type: string) {
  listeners[type]?.forEach((fn) => fn(new Event(type)))
}

describe('OfflineBanner', () => {
  it('is hidden when navigator.onLine is true', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    render(<OfflineBanner />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('is visible when navigator.onLine is false', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    render(<OfflineBanner />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/You're offline/)).toBeInTheDocument()
  })

  it('appears when offline event fires', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    render(<OfflineBanner />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    act(() => fireWindowEvent('offline'))
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('disappears when online event fires', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    render(<OfflineBanner />)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    act(() => fireWindowEvent('online'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('has assertive aria-live for accessibility', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    render(<OfflineBanner />)
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive')
  })

  it('cleans up event listeners on unmount', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    const { unmount } = render(<OfflineBanner />)
    expect(listeners.offline.size).toBe(1)
    expect(listeners.online.size).toBe(1)

    unmount()
    expect(listeners.offline.size).toBe(0)
    expect(listeners.online.size).toBe(0)
  })
})
