import { logger } from './logger.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  name: string;
}

const DEFAULTS: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  name: 'unnamed',
};

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly options: CircuitBreakerOptions;

  constructor(options?: Partial<CircuitBreakerOptions>) {
    this.options = { ...DEFAULTS, ...options };
  }

  get currentState(): CircuitState {
    return this.state;
  }

  get consecutiveFailures(): number {
    return this.failureCount;
  }

  /**
   * Execute an async operation through the circuit breaker.
   *
   * CLOSED: execute normally; trip to OPEN after threshold consecutive failures.
   * OPEN: throw immediately unless cooldown has elapsed, then move to HALF_OPEN.
   * HALF_OPEN: allow one probe request; success → CLOSED, failure → OPEN.
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.options.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        logger.info('Circuit breaker half-open, testing', { name: this.options.name });
      } else {
        throw new CircuitOpenError(
          `Circuit breaker is OPEN for ${this.options.name}`,
          this.options.name,
        );
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      logger.info('Circuit breaker closed (recovered)', { name: this.options.name });
    }
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      logger.warn('Circuit breaker re-opened (half-open test failed)', {
        name: this.options.name,
        failureCount: this.failureCount,
      });
      return;
    }

    if (this.failureCount >= this.options.failureThreshold) {
      this.state = 'OPEN';
      logger.warn('Circuit breaker opened', {
        name: this.options.name,
        failureCount: this.failureCount,
        resetTimeoutMs: this.options.resetTimeoutMs,
      });
    }
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}

export class CircuitOpenError extends Error {
  public readonly circuitName: string;

  constructor(message: string, circuitName: string) {
    super(message);
    this.name = 'CircuitOpenError';
    this.circuitName = circuitName;
  }
}
