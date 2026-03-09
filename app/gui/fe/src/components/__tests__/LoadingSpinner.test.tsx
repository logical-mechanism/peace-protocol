import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import LoadingSpinner, { DelayedSpinner } from '../LoadingSpinner';

describe('LoadingSpinner', () => {
  it('renders with role="status"', () => {
    render(<LoadingSpinner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('uses default "Loading" aria-label', () => {
    render(<LoadingSpinner />);
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('uses custom label for aria-label', () => {
    render(<LoadingSpinner label="Saving" />);
    expect(screen.getByLabelText('Saving')).toBeInTheDocument();
  });

  it('applies sm size class', () => {
    const { container } = render(<LoadingSpinner size="sm" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('class')).toContain('w-4 h-4');
  });

  it('applies md size class by default', () => {
    const { container } = render(<LoadingSpinner />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('class')).toContain('w-6 h-6');
  });

  it('applies lg size class', () => {
    const { container } = render(<LoadingSpinner size="lg" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('class')).toContain('w-8 h-8');
  });
});

describe('DelayedSpinner', () => {
  it('does not render immediately', () => {
    vi.useFakeTimers();
    render(<DelayedSpinner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders after the delay', () => {
    vi.useFakeTimers();
    render(<DelayedSpinner delay={200} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByRole('status')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('uses default 300ms delay', () => {
    vi.useFakeTimers();
    render(<DelayedSpinner />);

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
