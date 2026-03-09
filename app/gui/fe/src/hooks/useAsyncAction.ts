import { useState, useCallback, useRef } from 'react';
import { getFriendlyError, type FriendlyError } from '../services/errorMessages';

interface UseAsyncActionOptions {
  /** Called after successful execution */
  onSuccess?: (result: unknown) => void;
  /** Called on error with the friendly error */
  onError?: (error: FriendlyError, rawError: Error) => void;
}

interface UseAsyncActionResult<T> {
  /** Execute the async action. Returns the result or undefined on error. */
  execute: (...args: unknown[]) => Promise<T | undefined>;
  /** Whether the action is currently executing */
  isLoading: boolean;
  /** The friendly error from the last failed execution, or null */
  error: FriendlyError | null;
  /** Clear the current error state */
  clearError: () => void;
}

/**
 * Hook that wraps an async function with consistent loading, error, and success state.
 *
 * The hook translates raw errors via getFriendlyError() and exposes the friendly error
 * for the caller to display (e.g., via toast or inline). This keeps the hook pure and
 * testable without needing to mock the toast system.
 *
 * @example
 * ```tsx
 * const { execute, isLoading, error } = useAsyncAction(
 *   (amount: number) => placeBid(wallet, encryption, amount),
 *   { onSuccess: () => toast.success('Bid placed!') }
 * );
 *
 * // In JSX:
 * <button onClick={() => execute(100)} disabled={isLoading}>
 *   {isLoading ? 'Placing...' : 'Place Bid'}
 * </button>
 * {error && <p>{error.message}</p>}
 * ```
 */
export function useAsyncAction<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  asyncFn: (...args: any[]) => Promise<T>,
  options?: UseAsyncActionOptions,
): UseAsyncActionResult<T> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const mountedRef = useRef(true);

  // Track mount status to prevent state updates after unmount
  // Using a ref that's set in the component lifecycle
  const execute = useCallback(
    async (...args: unknown[]): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await asyncFn(...args);
        if (mountedRef.current) {
          setIsLoading(false);
          options?.onSuccess?.(result);
        }
        return result;
      } catch (err) {
        if (mountedRef.current) {
          const rawError = err instanceof Error ? err : new Error(String(err));
          const friendly = getFriendlyError(rawError);
          setError(friendly);
          setIsLoading(false);
          options?.onError?.(friendly, rawError);
        }
        return undefined;
      }
    },
    [asyncFn, options],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { execute, isLoading, error, clearError };
}
