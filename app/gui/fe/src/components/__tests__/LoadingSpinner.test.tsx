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

  it('renders arc variant by default as an svg', () => {
    const { container } = render(<LoadingSpinner />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders ring variant as a bordered div', () => {
    const { container } = render(<LoadingSpinner variant="ring" size="lg" />);
    expect(container.querySelector('svg')).toBeNull();
    const div = container.querySelector('div[role="status"]')!;
    expect(div).toBeInTheDocument();
    const cls = div.getAttribute('class') || '';
    expect(cls).toContain('animate-spin');
    expect(cls).toContain('rounded-full');
    expect(cls).toContain('border-t-[var(--accent)]');
    expect(cls).toContain('w-8 h-8');
  });

  it('ring variant keeps accessible label', () => {
    render(<LoadingSpinner variant="ring" label="Proving" />);
    expect(screen.getByLabelText('Proving')).toBeInTheDocument();
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
