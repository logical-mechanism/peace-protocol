import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { ModalProvider } from '../../contexts/ModalContext';
import { useModalStack } from '../useModalStack';

function renderModalStackHook(
  initialIsOpen: boolean,
  onClose = vi.fn(),
  disabled = false,
) {
  return renderHook(
    ({ isOpen, disabled: d }) =>
      useModalStack('test-modal', isOpen, onClose, d),
    {
      initialProps: { isOpen: initialIsOpen, disabled },
      wrapper: ({ children }: { children: React.ReactNode }) =>
        React.createElement(ModalProvider, null, children),
    },
  );
}

describe('useModalStack', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.style.overflow = '';
  });

  it('shouldRender=true when isOpen=true initially', () => {
    const { result } = renderModalStackHook(true);
    expect(result.current.shouldRender).toBe(true);
  });

  it('shouldRender=false when isOpen=false initially', () => {
    const { result } = renderModalStackHook(false);
    expect(result.current.shouldRender).toBe(false);
  });

  it('transitions to entering then entered when opening', () => {
    const { result, rerender } = renderModalStackHook(false);
    expect(result.current.shouldRender).toBe(false);

    // Open the modal
    rerender({ isOpen: true, disabled: false });
    expect(result.current.shouldRender).toBe(true);
    expect(result.current.animationState).toBe('entering');

    // After 200ms, should transition to entered
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current.animationState).toBe('entered');
  });

  it('shouldRender stays true during exit animation (150ms)', () => {
    const { result, rerender } = renderModalStackHook(true);
    expect(result.current.shouldRender).toBe(true);

    // Close the modal
    rerender({ isOpen: false, disabled: false });
    expect(result.current.animationState).toBe('exiting');
    expect(result.current.shouldRender).toBe(true);

    // Still rendering at 100ms
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.shouldRender).toBe(true);

    // After 150ms total, should unmount
    act(() => { vi.advanceTimersByTime(50); });
    expect(result.current.shouldRender).toBe(false);
  });

  it('full lifecycle: closed → open → entered → closing → unmounted', () => {
    const { result, rerender } = renderModalStackHook(false);

    // Open
    rerender({ isOpen: true, disabled: false });
    expect(result.current.shouldRender).toBe(true);
    expect(result.current.animationState).toBe('entering');

    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current.animationState).toBe('entered');

    // Close
    rerender({ isOpen: false, disabled: false });
    expect(result.current.animationState).toBe('exiting');
    expect(result.current.shouldRender).toBe(true);

    act(() => { vi.advanceTimersByTime(150); });
    expect(result.current.shouldRender).toBe(false);
  });

  it('locks body scroll when shouldRender is true', () => {
    const { rerender } = renderModalStackHook(false);
    expect(document.body.style.overflow).not.toBe('hidden');

    rerender({ isOpen: true, disabled: false });
    expect(document.body.style.overflow).toBe('hidden');

    // Start closing — body stays locked during exit animation
    rerender({ isOpen: false, disabled: false });
    expect(document.body.style.overflow).toBe('hidden');

    // After exit animation, body unlocks
    act(() => { vi.advanceTimersByTime(150); });
    expect(document.body.style.overflow).toBe('unset');
  });

  it('blocks Escape when disabled=true', () => {
    const onClose = vi.fn();
    renderModalStackHook(true, onClose, true);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose on Escape when not disabled', () => {
    const onClose = vi.fn();
    renderModalStackHook(true, onClose, false);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns a z-index when open', () => {
    const { result } = renderModalStackHook(true);
    expect(result.current.zIndex).toBeGreaterThanOrEqual(50);
  });
});
