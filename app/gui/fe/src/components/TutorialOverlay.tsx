import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TutorialStep } from '../hooks/useTutorial'

const PADDING = 8
const TOOLTIP_WIDTH = 320
const TOOLTIP_GAP = 12
// Keep the screen dimmed but hide the tooltip for this long after a step
// change. Most targets mount within this window (tab switches, modal open
// animations), so suppressing the centered fallback here prevents a visible
// snap from screen-center to the newly-resolved spotlight.
const STEP_TRANSITION_GRACE_MS = 400
// Smoothly animate the spotlight and tooltip between anchors instead of
// teleporting when the step changes and both targets are already mounted.
const SPOTLIGHT_TRANSITION_MS = 200

interface TutorialOverlayProps {
  step: TutorialStep | null
  stepIndex: number
  totalSteps: number
  onNext: () => void
  onSkip: () => void
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

interface TooltipPos {
  top: number
  left: number
}

function rectsEqual(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

function getTargetRect(selector: string): Rect | null {
  const el = document.querySelector(selector) as HTMLElement | null
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function computeTooltipPosition(
  target: Rect,
  placement: TutorialStep['placement'] = 'bottom',
  viewportWidth: number,
  viewportHeight: number,
  tooltipHeight: number,
): TooltipPos {
  let top: number
  let left: number
  switch (placement) {
    case 'top':
      top = target.top - tooltipHeight - TOOLTIP_GAP
      left = target.left + target.width / 2 - TOOLTIP_WIDTH / 2
      break
    case 'left':
      top = target.top + target.height / 2 - tooltipHeight / 2
      left = target.left - TOOLTIP_WIDTH - TOOLTIP_GAP
      break
    case 'right':
      top = target.top + target.height / 2 - tooltipHeight / 2
      left = target.left + target.width + TOOLTIP_GAP
      break
    case 'bottom':
    default:
      top = target.top + target.height + TOOLTIP_GAP
      left = target.left + target.width / 2 - TOOLTIP_WIDTH / 2
      break
  }
  // Clamp to viewport
  left = Math.max(PADDING, Math.min(left, viewportWidth - TOOLTIP_WIDTH - PADDING))
  top = Math.max(PADDING, Math.min(top, viewportHeight - tooltipHeight - PADDING))
  return { top, left }
}

export default function TutorialOverlay({
  step,
  stepIndex,
  totalSteps,
  onNext,
  onSkip,
}: TutorialOverlayProps) {
  const { t } = useTranslation('common')
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const [tooltipPos, setTooltipPos] = useState<TooltipPos>({ top: 0, left: 0 })
  const [inTransition, setInTransition] = useState(false)
  const prevStepRef = useRef<TutorialStep | null>(null)
  const scrolledForStepRef = useRef<TutorialStep | null>(null)

  const updatePosition = useCallback(() => {
    if (!step) {
      setTargetRect((prev) => (prev === null ? prev : null))
      return
    }
    const rect = getTargetRect(step.targetSelector)
    // Dedupe via rectsEqual — getBoundingClientRect returns a fresh object
    // every tick, so without this the 200ms polling loop would re-render the
    // overlay ~5x/sec even when nothing moved.
    setTargetRect((prev) => (rectsEqual(prev, rect) ? prev : rect))
  }, [step])

  // Activate a brief transition window on step change. During this window we
  // keep the screen dimmed but hide the tooltip so the overlay doesn't flash
  // from centered-fallback back to the next spotlight as the new anchor
  // mounts (e.g. a modal opening between steps).
  useEffect(() => {
    if (!step) {
      prevStepRef.current = null
      return
    }
    scrolledForStepRef.current = null
    const isStepChange = prevStepRef.current !== null && prevStepRef.current !== step
    prevStepRef.current = step
    if (!isStepChange) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- transition window must arm as soon as the step prop changes
    setInTransition(true)
    const timer = window.setTimeout(() => setInTransition(false), STEP_TRANSITION_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [step])

  // Poll for the target (may mount after this overlay — e.g. a modal opening
  // on step 2). Polling stops visibly once the element is found and re-runs
  // on window resize/scroll; the updatePosition short-circuit keeps a stable
  // target from causing idle re-renders.
  useEffect(() => {
    if (!step) return
    // Measure synchronously so an already-mounted anchor spotlights on the
    // first render instead of waiting a tick. This is a DOM-sync setState
    // (reading getBoundingClientRect), not a cascading-render pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM measurement, not derived state
    updatePosition()
    const interval = window.setInterval(updatePosition, 200)
    const handleResize = () => updatePosition()
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleResize, true)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleResize, true)
    }
  }, [step, updatePosition])

  // Scroll each step's target into view exactly once when it first resolves.
  // Re-firing smooth scrolls on every rect update interrupts in-flight scrolls
  // and looks choppy, especially when a modal shifts layout under the anchor.
  useEffect(() => {
    if (!step || !targetRect) return
    if (scrolledForStepRef.current === step) return
    const el = document.querySelector(step.targetSelector) as HTMLElement | null
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      scrolledForStepRef.current = step
    }
  }, [step, targetRect])

  // Compute tooltip position after render so we know its actual height.
  // Dedupe via primitive compare so identical positions don't feed back into
  // re-renders.
  useLayoutEffect(() => {
    if (!step || !targetRect || !tooltipRef.current) return
    const tooltipHeight = tooltipRef.current.offsetHeight || 160
    const pos = computeTooltipPosition(
      targetRect,
      step.placement,
      window.innerWidth,
      window.innerHeight,
      tooltipHeight,
    )
    // eslint-disable-next-line react-hooks/set-state-in-effect -- layout effect syncing DOM-measured position
    setTooltipPos((prev) => (prev.top === pos.top && prev.left === pos.left ? prev : pos))
  }, [step, targetRect])

  // Keyboard: Escape skips, Enter advances
  useEffect(() => {
    if (!step) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onSkip()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onNext()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [step, onSkip, onNext])

  if (!step) return null

  const isLast = stepIndex === totalSteps - 1

  // Mid-transition with no target yet: hold the dim screen but hide the
  // tooltip so the next anchor can mount before anything renders on top.
  if (inTransition && !targetRect) {
    return (
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)', zIndex: 90 }}
      />
    )
  }

  // Spotlight: a positioned box at the target with a huge outer shadow that
  // dims everything else. CSS transitions smooth the move to the next anchor
  // when both targets are already mounted. When the target isn't found,
  // render a fullscreen dim with a centered tooltip instead.
  const spotlight = targetRect && (
    <div
      aria-hidden
      className="fixed pointer-events-none rounded-[var(--radius-md)]"
      style={{
        top: targetRect.top - PADDING,
        left: targetRect.left - PADDING,
        width: targetRect.width + PADDING * 2,
        height: targetRect.height + PADDING * 2,
        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6)',
        animation: 'tutorial-spotlight 1.6s ease-in-out infinite',
        transition: `top ${SPOTLIGHT_TRANSITION_MS}ms ease, left ${SPOTLIGHT_TRANSITION_MS}ms ease, width ${SPOTLIGHT_TRANSITION_MS}ms ease, height ${SPOTLIGHT_TRANSITION_MS}ms ease`,
        zIndex: 90,
      }}
    />
  )

  const fallbackDim = !targetRect && (
    <div
      aria-hidden
      className="fixed inset-0 pointer-events-none"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)', zIndex: 90 }}
    />
  )

  const tooltipStyle: React.CSSProperties = targetRect
    ? {
        top: tooltipPos.top,
        left: tooltipPos.left,
        width: TOOLTIP_WIDTH,
        zIndex: 91,
        transition: `top ${SPOTLIGHT_TRANSITION_MS}ms ease, left ${SPOTLIGHT_TRANSITION_MS}ms ease`,
      }
    : {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: TOOLTIP_WIDTH,
        zIndex: 91,
      }

  return (
    <>
      {spotlight}
      {fallbackDim}
      <div
        ref={tooltipRef}
        role="dialog"
        aria-label={t('tutorial.stepAria')}
        aria-labelledby="tutorial-step-title"
        className="fixed rounded-[var(--radius-lg)] p-5 shadow-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]"
        style={tooltipStyle}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
            {stepIndex + 1} / {totalSteps}
          </span>
          <button
            onClick={onSkip}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            aria-label={t('tutorial.skipTutorial')}
          >
            {t('tutorial.skip')}
          </button>
        </div>
        <h3 id="tutorial-step-title" className="text-base font-semibold text-[var(--text-primary)] mb-2">
          {step.title}
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-4">
          {step.description}
        </p>
        <div className="flex justify-end">
          <button
            onClick={onNext}
            className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] btn-base btn-primary cursor-pointer"
          >
            {isLast ? t('tutorial.finish') : t('actions.next')}
          </button>
        </div>
      </div>
    </>
  )
}
