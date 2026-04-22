import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import TutorialOverlay from '../TutorialOverlay'
import type { TutorialStep } from '../../hooks/useTutorial'

const STEP: TutorialStep = {
  targetSelector: '#tutorial-target',
  title: 'Try this',
  description: 'Click the thing',
  placement: 'bottom',
}

function mountTarget(): HTMLDivElement {
  const el = document.createElement('div')
  el.id = 'tutorial-target'
  el.getBoundingClientRect = () =>
    ({ top: 100, left: 100, width: 80, height: 40, right: 180, bottom: 140, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect
  el.scrollIntoView = vi.fn()
  document.body.appendChild(el)
  return el
}

describe('TutorialOverlay', () => {
  beforeEach(() => {
    // jsdom defaults to small viewport; set reasonable size
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders nothing when step is null', () => {
    const { container } = render(
      <TutorialOverlay step={null} stepIndex={0} totalSteps={0} onNext={vi.fn()} onSkip={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders title, description, and step counter', () => {
    mountTarget()
    render(
      <TutorialOverlay step={STEP} stepIndex={1} totalSteps={4} onNext={vi.fn()} onSkip={vi.fn()} />,
    )
    expect(screen.getByText('Try this')).toBeInTheDocument()
    expect(screen.getByText('Click the thing')).toBeInTheDocument()
    expect(screen.getByText('2 / 4')).toBeInTheDocument()
  })

  it('shows Next button except on the final step, which shows Finish', () => {
    mountTarget()
    const { rerender } = render(
      <TutorialOverlay step={STEP} stepIndex={0} totalSteps={3} onNext={vi.fn()} onSkip={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
    rerender(
      <TutorialOverlay step={STEP} stepIndex={2} totalSteps={3} onNext={vi.fn()} onSkip={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument()
  })

  it('Next button fires onNext', () => {
    mountTarget()
    const onNext = vi.fn()
    render(
      <TutorialOverlay step={STEP} stepIndex={0} totalSteps={3} onNext={onNext} onSkip={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('Skip button fires onSkip', () => {
    mountTarget()
    const onSkip = vi.fn()
    render(
      <TutorialOverlay step={STEP} stepIndex={0} totalSteps={3} onNext={vi.fn()} onSkip={onSkip} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Skip tutorial' }))
    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('Escape key fires onSkip', () => {
    mountTarget()
    const onSkip = vi.fn()
    render(
      <TutorialOverlay step={STEP} stepIndex={0} totalSteps={3} onNext={vi.fn()} onSkip={onSkip} />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('Enter key fires onNext', () => {
    mountTarget()
    const onNext = vi.fn()
    render(
      <TutorialOverlay step={STEP} stepIndex={0} totalSteps={3} onNext={onNext} onSkip={vi.fn()} />,
    )
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('scrolls target into view when found', async () => {
    const target = mountTarget()
    render(
      <TutorialOverlay step={STEP} stepIndex={0} totalSteps={3} onNext={vi.fn()} onSkip={vi.fn()} />,
    )
    await waitFor(() => expect(target.scrollIntoView).toHaveBeenCalled())
  })

  it('falls back to centered tooltip when target is missing', () => {
    // No target in the DOM
    render(
      <TutorialOverlay step={STEP} stepIndex={0} totalSteps={3} onNext={vi.fn()} onSkip={vi.fn()} />,
    )
    // Still renders the dialog content
    expect(screen.getByText('Try this')).toBeInTheDocument()
  })

  it('hides the tooltip during the step-change grace window if the next anchor is missing', async () => {
    vi.useFakeTimers()
    try {
      const target = mountTarget()
      const { rerender } = render(
        <TutorialOverlay step={STEP} stepIndex={0} totalSteps={3} onNext={vi.fn()} onSkip={vi.fn()} />,
      )
      expect(screen.getByText('Try this')).toBeInTheDocument()
      // Simulate advancing to a step whose anchor isn't mounted yet (e.g. a
      // modal is opening). The overlay should suppress the centered tooltip
      // during the grace window rather than flashing it before the anchor
      // appears.
      target.remove()
      const NEXT_STEP: TutorialStep = {
        targetSelector: '#not-mounted-yet',
        title: 'Next step',
        description: 'Body',
        placement: 'bottom',
      }
      rerender(
        <TutorialOverlay step={NEXT_STEP} stepIndex={1} totalSteps={3} onNext={vi.fn()} onSkip={vi.fn()} />,
      )
      expect(screen.queryByText('Next step')).not.toBeInTheDocument()
      // After the grace window elapses, the centered fallback tooltip
      // appears for the still-missing target.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(screen.getByText('Next step')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not re-fire scrollIntoView when the target stays in place', async () => {
    vi.useFakeTimers()
    try {
      const target = mountTarget()
      render(
        <TutorialOverlay step={STEP} stepIndex={0} totalSteps={3} onNext={vi.fn()} onSkip={vi.fn()} />,
      )
      // Let the synchronous initial measurement fire scrollIntoView once.
      expect(target.scrollIntoView).toHaveBeenCalledTimes(1)
      // Ride through several polling ticks — rect hasn't changed, so the
      // smooth scroll must not keep re-triggering itself.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1200)
      })
      expect(target.scrollIntoView).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
