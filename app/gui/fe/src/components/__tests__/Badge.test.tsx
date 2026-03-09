import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import Badge, { EncryptionStatusBadge, BidStatusBadge } from '../Badge';

describe('Badge', () => {
  it('renders children', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('defaults to neutral variant', () => {
    const { container } = render(<Badge>Test</Badge>);
    const badge = container.firstElementChild!;
    expect(badge.className).toContain('bg-[var(--bg-secondary)]');
  });

  it('applies success variant classes', () => {
    const { container } = render(<Badge variant="success">OK</Badge>);
    const badge = container.firstElementChild!;
    expect(badge.className).toContain('bg-[var(--success-muted)]');
    expect(badge.className).toContain('text-[var(--success)]');
  });

  it('applies error variant classes', () => {
    const { container } = render(<Badge variant="error">Fail</Badge>);
    const badge = container.firstElementChild!;
    expect(badge.className).toContain('bg-[var(--error-muted)]');
  });

  it('renders dot when dot=true', () => {
    const { container } = render(<Badge dot>Dotted</Badge>);
    const dot = container.querySelector('.rounded-full');
    expect(dot).toBeInTheDocument();
  });

  it('does not render dot by default', () => {
    const { container } = render(<Badge>No Dot</Badge>);
    const dots = container.querySelectorAll('.w-1\\.5.h-1\\.5');
    expect(dots).toHaveLength(0);
  });

  it('applies custom className', () => {
    const { container } = render(<Badge className="ml-2">Custom</Badge>);
    const badge = container.firstElementChild!;
    expect(badge.className).toContain('ml-2');
  });
});

describe('EncryptionStatusBadge', () => {
  it('renders Active for active status', () => {
    render(<EncryptionStatusBadge status="active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders Pending for pending status', () => {
    render(<EncryptionStatusBadge status="pending" />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('renders Completed for completed status', () => {
    render(<EncryptionStatusBadge status="completed" />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });
});

describe('BidStatusBadge', () => {
  it('renders Pending for pending status', () => {
    render(<BidStatusBadge status="pending" />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('renders Accepted for accepted status', () => {
    render(<BidStatusBadge status="accepted" />);
    expect(screen.getByText('Accepted')).toBeInTheDocument();
  });

  it('renders Rejected for rejected status', () => {
    render(<BidStatusBadge status="rejected" />);
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });

  it('renders Cancelled for cancelled status', () => {
    render(<BidStatusBadge status="cancelled" />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });
});
