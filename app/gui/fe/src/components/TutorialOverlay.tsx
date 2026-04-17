import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TutorialStep } from '../hooks/useTutorial'

const PADDING = 8
const TOOLTIP_WIDTH = 320
const TOOLTIP_GAP = 12

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

  const updatePosition = useCallback(() => {
    if (!step) {
      setTargetRect(null)
      return
    }
    const rect = getTargetRect(step.targetSelector)
    setTargetRect(rect)
  }, [step])

  // Recalculate target rect with a short polling interval (the target may mount
  // after this overlay — e.g. a modal opening in step 2). Polling stops once the
  // element is found and re-triggers on window resize/scroll.
  useEffect(() => {
    if (!step) return
    // Kick off the first measurement on the next tick so it runs outside the
    // effect body (subscribing to external DOM state, not cascading render).
    const initial = window.setTimeout(updatePosition, 0)
    const interval = window.setInterval(updatePosition, 200)
    const handleResize = () => updatePosition()
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleResize, true)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleResize, true)
    }
  }, [step, updatePosition])

  // Scroll target into view once resolved
  const targetTop = targetRect?.top
  const targetLeft = targetRect?.left
  useEffect(() => {
    if (!step || targetTop === undefined || targetLeft === undefined) return
    const el = document.querySelector(step.targetSelector) as HTMLElement | null
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [step, targetTop, targetLeft])

  // Compute tooltip position after render so we know its actual height.
  // Reading tooltip height from the DOM and writing the computed position is
  // exactly what layout effects are for; the setState is synchronous with
  // layout and happens before paint.
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
    setTooltipPos(pos)
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

  // Spotlight: a positioned box at the target with a huge outer shadow that dims everything else.
  // When the target isn't found yet, render a fullscreen dim with a centered tooltip instead.
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
    ? { top: tooltipPos.top, left: tooltipPos.left, width: TOOLTIP_WIDTH, zIndex: 91 }
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
