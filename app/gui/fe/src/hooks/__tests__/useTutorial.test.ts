import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTutorial, type TutorialStep } from '../useTutorial'

const STEPS: TutorialStep[] = [
  { targetSelector: '#a', title: 'A', description: 'step a' },
  { targetSelector: '#b', title: 'B', description: 'step b' },
  { targetSelector: '#c', title: 'C', description: 'step c' },
]

describe('useTutorial', () => {
  it('starts in idle state with no current step', () => {
    const { result } = renderHook(() => useTutorial())
    expect(result.current.status).toBe('idle')
    expect(result.current.isTutorialActive).toBe(false)
    expect(result.current.currentStep).toBeNull()
    expect(result.current.totalSteps).toBe(0)
  })

  it('startTutorial activates with the first step', () => {
    const { result } = renderHook(() => useTutorial())
    act(() => result.current.startTutorial(STEPS))
    expect(result.current.status).toBe('active')
    expect(result.current.isTutorialActive).toBe(true)
    expect(result.current.currentStepIndex).toBe(0)
    expect(result.current.currentStep).toEqual(STEPS[0])
    expect(result.current.totalSteps).toBe(3)
  })

  it('startTutorial with empty array is a no-op', () => {
    const { result } = renderHook(() => useTutorial())
    act(() => result.current.startTutorial([]))
    expect(result.current.status).toBe('idle')
  })

  it('nextStep advances through the sequence', () => {
    const { result } = renderHook(() => useTutorial())
    act(() => result.current.startTutorial(STEPS))
    act(() => result.current.nextStep())
    expect(result.current.currentStepIndex).toBe(1)
    expect(result.current.currentStep).toEqual(STEPS[1])
    act(() => result.current.nextStep())
    expect(result.current.currentStepIndex).toBe(2)
    expect(result.current.currentStep).toEqual(STEPS[2])
  })

  it('nextStep on the final step marks completed and fires onComplete', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useTutorial())
    act(() => result.current.startTutorial(STEPS, { onComplete }))
    act(() => result.current.nextStep())
    act(() => result.current.nextStep())
    act(() => result.current.nextStep())
    expect(result.current.status).toBe('completed')
    expect(result.current.isTutorialActive).toBe(false)
    expect(result.current.currentStep).toBeNull()
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('skipTutorial marks completed and fires onSkip', () => {
    const onSkip = vi.fn()
    const onComplete = vi.fn()
    const { result } = renderHook(() => useTutorial())
    act(() => result.current.startTutorial(STEPS, { onSkip, onComplete }))
    act(() => result.current.skipTutorial())
    expect(result.current.status).toBe('completed')
    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('can restart after completion', () => {
    const { result } = renderHook(() => useTutorial())
    act(() => result.current.startTutorial(STEPS))
    act(() => result.current.skipTutorial())
    expect(result.current.status).toBe('completed')
    act(() => result.current.startTutorial([STEPS[0]]))
    expect(result.current.status).toBe('active')
    expect(result.current.totalSteps).toBe(1)
    expect(result.current.currentStepIndex).toBe(0)
  })

  it('startTutorial honors the startStep option for mid-flow joins', () => {
    const { result } = renderHook(() => useTutorial())
    act(() => result.current.startTutorial(STEPS, { startStep: 1 }))
    expect(result.current.currentStepIndex).toBe(1)
    expect(result.current.currentStep).toEqual(STEPS[1])
  })

  it('startTutorial clamps startStep to the valid range', () => {
    const { result } = renderHook(() => useTutorial())
    act(() => result.current.startTutorial(STEPS, { startStep: 99 }))
    expect(result.current.currentStepIndex).toBe(2)
    act(() => result.current.startTutorial(STEPS, { startStep: -5 }))
    expect(result.current.currentStepIndex).toBe(0)
  })

  it('goToStep jumps to the requested index when active', () => {
    const { result } = renderHook(() => useTutorial())
    act(() => result.current.startTutorial(STEPS))
    act(() => result.current.goToStep(2))
    expect(result.current.currentStepIndex).toBe(2)
    expect(result.current.currentStep).toEqual(STEPS[2])
  })

  it('goToStep clamps out-of-range indices', () => {
    const { result } = renderHook(() => useTutorial())
    act(() => result.current.startTutorial(STEPS))
    act(() => result.current.goToStep(99))
    expect(result.current.currentStepIndex).toBe(2)
    act(() => result.current.goToStep(-1))
    expect(result.current.currentStepIndex).toBe(0)
  })

  it('goToStep is a no-op before startTutorial', () => {
    const { result } = renderHook(() => useTutorial())
    act(() => result.current.goToStep(1))
    expect(result.current.currentStepIndex).toBe(0)
    expect(result.current.status).toBe('idle')
  })
})
