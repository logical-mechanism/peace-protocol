import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ErrorBoundary, { InlineErrorBoundary } from '../ErrorBoundary';

// ── Helpers ──────────────────────────────────────────────────────────

/** Component that throws on render — used to trigger error boundaries. */
function ThrowingChild({ message = 'render boom' }: { message?: string }): React.ReactElement {
  throw new Error(message);
}

/** Suppress noisy console.error from React + ErrorBoundary during expected throws. */
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ── ErrorBoundary (full-page) ────────────────────────────────────────

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('shows default fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByText(/An unexpected error occurred/)
    ).toBeInTheDocument();
  });

  it('displays the error message in a collapsible details element', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="kaboom" />
      </ErrorBoundary>
    );
    expect(screen.getByText('Error details')).toBeInTheDocument();
    expect(screen.getByText('kaboom')).toBeInTheDocument();
  });

  it('"Try Again" resets the error and re-renders children', () => {
    let shouldThrow = true;

    function MaybeThrow() {
      if (shouldThrow) throw new Error('first render');
      return <p>Recovered</p>;
    }

    render(
      <ErrorBoundary>
        <MaybeThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Stop throwing before clicking reset
    shouldThrow = false;
    fireEvent.click(screen.getByText('Try Again'));

    expect(screen.getByText('Recovered')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('renders custom fallback prop instead of default UI', () => {
    render(
      <ErrorBoundary fallback={<div>Custom oops</div>}>
        <ThrowingChild />
      </ErrorBoundary>
    );
    expect(screen.getByText('Custom oops')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('calls onError callback with error and errorInfo', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <ThrowingChild message="callback test" />
      </ErrorBoundary>
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'callback test' }),
      expect.objectContaining({ componentStack: expect.any(String) })
    );
  });

  it('shows "Reload Page" button', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );
    expect(screen.getByText('Reload Page')).toBeInTheDocument();
  });
});

// ── InlineErrorBoundary ──────────────────────────────────────────────

describe('InlineErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <InlineErrorBoundary>
        <p>Inline content</p>
      </InlineErrorBoundary>
    );
    expect(screen.getByText('Inline content')).toBeInTheDocument();
  });

  it('shows inline fallback when a child throws', () => {
    render(
      <InlineErrorBoundary>
        <ThrowingChild message="inline boom" />
      </InlineErrorBoundary>
    );
    expect(screen.getByText('Failed to load this section')).toBeInTheDocument();
    expect(screen.getByText('inline boom')).toBeInTheDocument();
  });

  it('"Try again" resets the error state', () => {
    let shouldThrow = true;

    function MaybeThrow() {
      if (shouldThrow) throw new Error('inline fail');
      return <p>Inline recovered</p>;
    }

    render(
      <InlineErrorBoundary>
        <MaybeThrow />
      </InlineErrorBoundary>
    );
    expect(screen.getByText('Failed to load this section')).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByText('Try Again'));
    expect(screen.getByText('Inline recovered')).toBeInTheDocument();
  });

  it('renders custom fallback prop', () => {
    render(
      <InlineErrorBoundary fallback={<span>Custom inline fallback</span>}>
        <ThrowingChild />
      </InlineErrorBoundary>
    );
    expect(screen.getByText('Custom inline fallback')).toBeInTheDocument();
    expect(
      screen.queryByText('Failed to load this section')
    ).not.toBeInTheDocument();
  });

  it('calls onError callback', () => {
    const onError = vi.fn();
    render(
      <InlineErrorBoundary onError={onError}>
        <ThrowingChild message="cb inline" />
      </InlineErrorBoundary>
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('cb inline');
  });

  it('shows generic message when error has no message', () => {
    function ThrowEmpty(): React.ReactElement {
      throw new Error();
    }
    render(
      <InlineErrorBoundary>
        <ThrowEmpty />
      </InlineErrorBoundary>
    );
    expect(screen.getByText('An unexpected error occurred. Please try refreshing the page.')).toBeInTheDocument();
  });
});
