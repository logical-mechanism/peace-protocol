import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useInfiniteScroll } from '../useInfiniteScroll';

// Mock IntersectionObserver
let observerCallback: IntersectionObserverCallback;
let observerInstance: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };

beforeEach(() => {
  observerInstance = { observe: vi.fn(), disconnect: vi.fn() };
  vi.stubGlobal('IntersectionObserver', vi.fn((cb: IntersectionObserverCallback) => {
    observerCallback = cb;
    return observerInstance;
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useInfiniteScroll', () => {
  it('returns a ref object', () => {
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, onLoadMore: vi.fn() })
    );
    expect(result.current).toHaveProperty('current');
  });

  it('creates an observer when hasMore is true and sentinel is mounted', () => {
    const onLoadMore = vi.fn();
    const div = document.createElement('div');

    renderHook(() => {
      const ref = useInfiniteScroll({ hasMore: true, onLoadMore });
      Object.defineProperty(ref, 'current', { value: div, writable: true, configurable: true });
      return ref;
    });

    expect(IntersectionObserver).toHaveBeenCalled();
    expect(observerInstance.observe).toHaveBeenCalledWith(div);
  });

  it('does not create an observer when hasMore is false', () => {
    renderHook(() =>
      useInfiniteScroll({ hasMore: false, onLoadMore: vi.fn() })
    );
    expect(IntersectionObserver).not.toHaveBeenCalled();
  });

  it('calls onLoadMore when sentinel intersects', () => {
    const onLoadMore = vi.fn();
    const div = document.createElement('div');

    renderHook(() => {
      const ref = useInfiniteScroll({ hasMore: true, onLoadMore });
      Object.defineProperty(ref, 'current', { value: div, writable: true, configurable: true });
      return ref;
    });

    // Simulate intersection
    if (observerCallback) {
      observerCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        observerInstance as unknown as IntersectionObserver
      );
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    }
  });

  it('does not call onLoadMore when sentinel is not intersecting', () => {
    const onLoadMore = vi.fn();
    const div = document.createElement('div');

    renderHook(() => {
      const ref = useInfiniteScroll({ hasMore: true, onLoadMore });
      Object.defineProperty(ref, 'current', { value: div, writable: true, configurable: true });
      return ref;
    });

    if (observerCallback) {
      observerCallback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        observerInstance as unknown as IntersectionObserver
      );
      expect(onLoadMore).not.toHaveBeenCalled();
    }
  });

  it('uses default rootMargin of 200px', () => {
    const div = document.createElement('div');

    renderHook(() => {
      const ref = useInfiniteScroll({ hasMore: true, onLoadMore: vi.fn() });
      Object.defineProperty(ref, 'current', { value: div, writable: true, configurable: true });
      return ref;
    });

    expect(IntersectionObserver).toHaveBeenCalledWith(
      expect.any(Function),
      { rootMargin: '200px' }
    );
  });

  it('uses custom rootMargin when provided', () => {
    const div = document.createElement('div');

    renderHook(() => {
      const ref = useInfiniteScroll({ hasMore: true, onLoadMore: vi.fn(), rootMargin: '500px' });
      Object.defineProperty(ref, 'current', { value: div, writable: true, configurable: true });
      return ref;
    });

    expect(IntersectionObserver).toHaveBeenCalledWith(
      expect.any(Function),
      { rootMargin: '500px' }
    );
  });

  it('disconnects observer on unmount', () => {
    const div = document.createElement('div');

    const { unmount } = renderHook(() => {
      const ref = useInfiniteScroll({ hasMore: true, onLoadMore: vi.fn() });
      Object.defineProperty(ref, 'current', { value: div, writable: true, configurable: true });
      return ref;
    });

    unmount();
    expect(observerInstance.disconnect).toHaveBeenCalled();
  });
});
