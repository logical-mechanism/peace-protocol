import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVisibleInterval } from '../useVisibility';

describe('useVisibleInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Default: document is visible
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls callback immediately on mount when visible', () => {
    const cb = vi.fn();
    renderHook(() => useVisibleInterval(cb, 1000));
    expect(cb).toHaveBeenCalledOnce();
  });

  it('calls callback on each interval tick', () => {
    const cb = vi.fn();
    renderHook(() => useVisibleInterval(cb, 1000));
    cb.mockClear(); // clear the initial call

    act(() => { vi.advanceTimersByTime(1000); });
    expect(cb).toHaveBeenCalledOnce();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('pauses interval when document becomes hidden', () => {
    const cb = vi.fn();
    renderHook(() => useVisibleInterval(cb, 1000));
    cb.mockClear();

    // Hide document
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    // Advance timer — callback should not fire
    act(() => { vi.advanceTimersByTime(3000); });
    expect(cb).not.toHaveBeenCalled();
  });

  it('resumes interval and fires immediately when document becomes visible', () => {
    const cb = vi.fn();
    renderHook(() => useVisibleInterval(cb, 1000));
    cb.mockClear();

    // Hide
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    // Show again
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    // Should fire immediately on becoming visible
    expect(cb).toHaveBeenCalledOnce();

    // And resume interval
    cb.mockClear();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(cb).toHaveBeenCalledOnce();
  });

  it('returns a triggerNow function that fires callback immediately', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useVisibleInterval(cb, 5000));
    cb.mockClear();

    act(() => { result.current(); });
    expect(cb).toHaveBeenCalledOnce();
  });

  it('clears interval on unmount', () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useVisibleInterval(cb, 1000));
    cb.mockClear();

    unmount();

    act(() => { vi.advanceTimersByTime(5000); });
    expect(cb).not.toHaveBeenCalled();
  });

  it('does not start interval if document is hidden on mount', () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    const cb = vi.fn();
    renderHook(() => useVisibleInterval(cb, 1000));

    expect(cb).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(cb).not.toHaveBeenCalled();
  });

  it('uses latest callback ref when fired', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { rerender } = renderHook(
      ({ cb }) => useVisibleInterval(cb, 1000),
      { initialProps: { cb: cb1 } },
    );

    // Rerender with a new callback
    rerender({ cb: cb2 });

    cb1.mockClear();
    cb2.mockClear();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledOnce();
  });
});
