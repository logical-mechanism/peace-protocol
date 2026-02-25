import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAsyncAction } from '../useAsyncAction';

describe('useAsyncAction', () => {
  it('starts in idle state', () => {
    const { result } = renderHook(() =>
      useAsyncAction(async () => 'ok'),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets isLoading during execution', async () => {
    let resolve: (v: string) => void;
    const promise = new Promise<string>((r) => { resolve = r; });
    const asyncFn = vi.fn(() => promise);

    const { result } = renderHook(() => useAsyncAction(asyncFn));

    let executePromise: Promise<string | undefined>;
    act(() => {
      executePromise = result.current.execute();
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolve!('done');
      await executePromise!;
    });

    expect(result.current.isLoading).toBe(false);
  });

  it('returns result on success', async () => {
    const { result } = renderHook(() =>
      useAsyncAction(async () => 42),
    );

    let returnValue: number | undefined;
    await act(async () => {
      returnValue = await result.current.execute();
    });

    expect(returnValue).toBe(42);
    expect(result.current.error).toBeNull();
  });

  it('calls onSuccess callback', async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useAsyncAction(async () => 'result', { onSuccess }),
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(onSuccess).toHaveBeenCalledWith('result');
  });

  it('sets friendly error on failure', async () => {
    const { result } = renderHook(() =>
      useAsyncAction(async () => {
        throw new Error('Failed to fetch');
      }),
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).not.toBeNull();
    expect(result.current.error!.title).toBe('Network Error');
  });

  it('returns undefined on failure', async () => {
    const { result } = renderHook(() =>
      useAsyncAction(async () => {
        throw new Error('oops');
      }),
    );

    let returnValue: unknown;
    await act(async () => {
      returnValue = await result.current.execute();
    });

    expect(returnValue).toBeUndefined();
  });

  it('calls onError callback with friendly and raw error', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useAsyncAction(
        async () => { throw new Error('Kupo returned error'); },
        { onError },
      ),
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].title).toBe('Kupo Unavailable');
    expect(onError.mock.calls[0][1]).toBeInstanceOf(Error);
  });

  it('clears error with clearError', async () => {
    const { result } = renderHook(() =>
      useAsyncAction(async () => { throw new Error('fail'); }),
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  it('clears previous error on new execution', async () => {
    let shouldFail = true;
    const asyncFn = vi.fn(async () => {
      if (shouldFail) throw new Error('fail');
      return 'ok';
    });

    const { result } = renderHook(() => useAsyncAction(asyncFn));

    // First call fails
    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.error).not.toBeNull();

    // Second call succeeds
    shouldFail = false;
    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.error).toBeNull();
  });

  it('handles non-Error throws', async () => {
    const { result } = renderHook(() =>
      useAsyncAction(async () => {
        throw 'string error';
      }),
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.error!.message).toContain('string error');
  });

  it('passes arguments to async function', async () => {
    const asyncFn = vi.fn(async (a: number, b: string) => `${a}-${b}`);
    const { result } = renderHook(() => useAsyncAction(asyncFn));

    await act(async () => {
      await result.current.execute(42, 'hello');
    });

    expect(asyncFn).toHaveBeenCalledWith(42, 'hello');
  });
});
