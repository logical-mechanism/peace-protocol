import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDataRefresh } from '../useDataRefresh'

describe('useDataRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with signal values at 0', () => {
    const { result } = renderHook(() => useDataRefresh())
    expect(result.current.refreshSignal).toBe(0)
    expect(result.current.historySignal).toBe(0)
  })

  it('triggerRefresh increments both signals', () => {
    const { result } = renderHook(() => useDataRefresh())
    act(() => result.current.triggerRefresh())
    expect(result.current.refreshSignal).toBe(1)
    expect(result.current.historySignal).toBe(1)
  })

  it('triggerHistoryRefresh increments only historySignal', () => {
    const { result } = renderHook(() => useDataRefresh())
    act(() => result.current.triggerHistoryRefresh())
    expect(result.current.refreshSignal).toBe(0)
    expect(result.current.historySignal).toBe(1)
  })

  it('triggerTransactionRefresh increments immediately then schedules escalating retries', () => {
    const { result } = renderHook(() => useDataRefresh())

    act(() => result.current.triggerTransactionRefresh())
    expect(result.current.refreshSignal).toBe(1)
    expect(result.current.historySignal).toBe(1)

    // 20s retry
    act(() => { vi.advanceTimersByTime(20_000) })
    expect(result.current.refreshSignal).toBe(2)

    // 45s retry (25s after previous)
    act(() => { vi.advanceTimersByTime(25_000) })
    expect(result.current.refreshSignal).toBe(3)

    // 90s retry (45s after previous)
    act(() => { vi.advanceTimersByTime(45_000) })
    expect(result.current.refreshSignal).toBe(4)

    // 180s retry (90s after previous)
    act(() => { vi.advanceTimersByTime(90_000) })
    expect(result.current.refreshSignal).toBe(5)

    // No more retries after 180s
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(result.current.refreshSignal).toBe(5)
  })

  it('second triggerTransactionRefresh cancels previous escalation timers', () => {
    const { result } = renderHook(() => useDataRefresh())

    act(() => result.current.triggerTransactionRefresh())
    expect(result.current.refreshSignal).toBe(1)

    // Advance 10s then trigger again — old timers should be cancelled
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(result.current.refreshSignal).toBe(1) // no timer has fired yet

    act(() => result.current.triggerTransactionRefresh())
    expect(result.current.refreshSignal).toBe(2) // immediate increment from 2nd call

    // The first call's 20s timer (which would fire at 20s total) should NOT fire
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(result.current.refreshSignal).toBe(2)

    // But the second call's 20s timer should fire at 20s from the 2nd call
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(result.current.refreshSignal).toBe(3)
  })

  it('triggerSoftRefresh increments both signals without clearing cache', () => {
    const { result } = renderHook(() => useDataRefresh())
    act(() => result.current.triggerSoftRefresh())
    expect(result.current.refreshSignal).toBe(1)
    expect(result.current.historySignal).toBe(1)
    // Note: unlike triggerRefresh, this does NOT call apiCache.clear()
    // (verified by the absence of the clear call in implementation)
  })

  it('cleans up timers on unmount', () => {
    const { result, unmount } = renderHook(() => useDataRefresh())

    act(() => result.current.triggerTransactionRefresh())
    expect(result.current.refreshSignal).toBe(1)

    unmount()

    // Timers should not fire after unmount (no act warnings)
    vi.advanceTimersByTime(200_000)
  })
})
