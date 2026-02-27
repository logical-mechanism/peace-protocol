import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { DelayedSpinner } from '../LoadingSpinner'

describe('DelayedSpinner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing initially', () => {
    const { container } = render(<DelayedSpinner />)
    expect(container.innerHTML).toBe('')
  })

  it('renders spinner after 300ms default delay', () => {
    render(<DelayedSpinner />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('does not render before delay elapses', () => {
    render(<DelayedSpinner />)

    act(() => {
      vi.advanceTimersByTime(299)
    })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('supports custom delay', () => {
    render(<DelayedSpinner delay={500} />)

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('passes size prop to LoadingSpinner', () => {
    render(<DelayedSpinner size="lg" />)

    act(() => {
      vi.advanceTimersByTime(300)
    })

    const spinner = screen.getByRole('status')
    expect(spinner.classList.contains('w-8')).toBe(true)
    expect(spinner.classList.contains('h-8')).toBe(true)
  })

  it('passes label prop to LoadingSpinner', () => {
    render(<DelayedSpinner label="Loading content" />)

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(screen.getByLabelText('Loading content')).toBeInTheDocument()
  })

  it('cleans up timer on unmount', () => {
    const { unmount } = render(<DelayedSpinner />)
    unmount()

    // Advancing timers after unmount should not cause errors
    act(() => {
      vi.advanceTimersByTime(300)
    })
  })
})
