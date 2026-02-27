import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import EmptyState, { PackageIcon, SearchIcon, InboxIcon } from '../EmptyState';

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No results" />);
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('has role="status"', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<EmptyState title="Empty" description="Try again later" />);
    expect(screen.getByText('Try again later')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    const { container } = render(<EmptyState title="Empty" />);
    expect(container.querySelectorAll('.text-sm')).toHaveLength(0);
  });

  it('renders action when provided', () => {
    render(<EmptyState title="Empty" action={<button>Retry</button>} />);
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(<EmptyState title="Empty" icon={<span data-testid="icon">I</span>} />);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('renders illustration over icon when both provided', () => {
    render(
      <EmptyState
        title="Empty"
        icon={<span data-testid="icon">I</span>}
        illustration={<span data-testid="illustration">IL</span>}
      />,
    );
    expect(screen.getByTestId('illustration')).toBeInTheDocument();
    expect(screen.queryByTestId('icon')).not.toBeInTheDocument();
  });
});

describe('Icon components', () => {
  it('PackageIcon renders an svg', () => {
    const { container } = render(<PackageIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('SearchIcon renders an svg', () => {
    const { container } = render(<SearchIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('InboxIcon renders an svg', () => {
    const { container } = render(<InboxIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('PackageIcon accepts custom className', () => {
    const { container } = render(<PackageIcon className="w-8 h-8" />);
    expect(container.querySelector('svg')!.getAttribute('class')).toContain('w-8 h-8');
  });
});
