import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../circuitBreaker.js';

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in CLOSED state', () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeoutMs: 1000 });
    expect(cb.currentState).toBe('CLOSED');
    expect(cb.consecutiveFailures).toBe(0);
  });

  it('passes through successful calls', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeoutMs: 1000 });
    const result = await cb.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
    expect(cb.currentState).toBe('CLOSED');
  });

  it('stays CLOSED below failure threshold', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeoutMs: 1000 });
    for (let i = 0; i < 2; i++) {
      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(cb.currentState).toBe('CLOSED');
    expect(cb.consecutiveFailures).toBe(2);
  });

  it('trips to OPEN after threshold consecutive failures', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeoutMs: 1000 });
    for (let i = 0; i < 3; i++) {
      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(cb.currentState).toBe('OPEN');
  });

  it('throws CircuitOpenError immediately when OPEN', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 5000 });
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    expect(cb.currentState).toBe('OPEN');

    await expect(cb.execute(() => Promise.resolve('ok')))
      .rejects.toThrow(CircuitOpenError);
  });

  it('CircuitOpenError has circuitName property', async () => {
    const cb = new CircuitBreaker({ name: 'koios', failureThreshold: 1, resetTimeoutMs: 5000 });
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

    try {
      await cb.execute(() => Promise.resolve('ok'));
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
      expect((err as CircuitOpenError).circuitName).toBe('koios');
    }
  });

  it('transitions to HALF_OPEN after resetTimeout and recovers on success', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 5000 });
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    expect(cb.currentState).toBe('OPEN');

    vi.advanceTimersByTime(5001);

    const result = await cb.execute(() => Promise.resolve('recovered'));
    expect(result).toBe('recovered');
    expect(cb.currentState).toBe('CLOSED');
    expect(cb.consecutiveFailures).toBe(0);
  });

  it('re-opens if HALF_OPEN test fails', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 5000 });
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

    vi.advanceTimersByTime(5001);

    await cb.execute(() => Promise.reject(new Error('still failing'))).catch(() => {});
    expect(cb.currentState).toBe('OPEN');
  });

  it('resets failure count on success', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeoutMs: 1000 });
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    expect(cb.consecutiveFailures).toBe(2);

    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.consecutiveFailures).toBe(0);
    expect(cb.currentState).toBe('CLOSED');
  });

  it('does not call the operation when circuit is OPEN', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 5000 });
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

    const operation = vi.fn(() => Promise.resolve('ok'));
    await cb.execute(operation).catch(() => {});
    expect(operation).not.toHaveBeenCalled();
  });

  it('reset() returns to clean CLOSED state', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 1000 });
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    expect(cb.currentState).toBe('OPEN');

    cb.reset();
    expect(cb.currentState).toBe('CLOSED');
    expect(cb.consecutiveFailures).toBe(0);

    const result = await cb.execute(() => Promise.resolve('works'));
    expect(result).toBe('works');
  });

  it('uses default options when none provided', () => {
    const cb = new CircuitBreaker();
    expect(cb.currentState).toBe('CLOSED');
  });
});
