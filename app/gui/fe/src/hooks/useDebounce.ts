import { useState, useEffect } from 'react';

/**
 * Debounce a value by the given delay. Returns the latest value only after
 * `delayMs` milliseconds of inactivity.
 */
export function useDebounce<T>(value: T, delayMs: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}
