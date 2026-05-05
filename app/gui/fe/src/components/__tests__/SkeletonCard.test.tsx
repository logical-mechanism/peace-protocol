import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SkeletonCard, SkeletonHistoryRow, SkeletonGrid, SkeletonHistoryList } from '../SkeletonCard';

describe('SkeletonCard', () => {
  it('renders shimmer elements in default mode', () => {
    const { container } = render(<SkeletonCard />);
    const shimmers = container.querySelectorAll('.skeleton-shimmer');
    expect(shimmers.length).toBeGreaterThan(0);
  });

  it('renders compact variant with different layout', () => {
    const { container } = render(<SkeletonCard compact />);
    const shimmers = container.querySelectorAll('.skeleton-shimmer');
    expect(shimmers.length).toBeGreaterThan(0);
    // Compact uses flex items-center gap-4 layout
    expect(container.querySelector('.flex.items-center.gap-4')).toBeInTheDocument();
  });
});

describe('SkeletonHistoryRow', () => {
  it('renders shimmer elements', () => {
    const { container } = render(<SkeletonHistoryRow />);
    const shimmers = container.querySelectorAll('.skeleton-shimmer');
    expect(shimmers.length).toBeGreaterThan(0);
  });
});

describe('SkeletonGrid', () => {
  it('renders default 8 skeleton cards', () => {
    const { container } = render(<SkeletonGrid />);
    const cards = container.querySelectorAll('.skeleton-shimmer');
    // 8 cards × multiple shimmers per card
    expect(cards.length).toBeGreaterThanOrEqual(8);
  });

  it('renders specified count of cards', () => {
    const { container } = render(<SkeletonGrid count={3} />);
    // SkeletonGrid renders [DelayedSpinner wrapper, grid container] in a Fragment.
    // The grid is the second top-level element.
    const grid = container.querySelector('.grid')!;
    expect(grid).not.toBeNull();
    expect(grid.children).toHaveLength(3);
  });

  it('renders compact variant in vertical stack', () => {
    const { container } = render(<SkeletonGrid count={4} compact />);
    const stack = container.querySelector('.space-y-3')!;
    expect(stack).not.toBeNull();
    expect(stack.children).toHaveLength(4);
  });
});

describe('SkeletonHistoryList', () => {
  it('renders default 6 history rows', () => {
    const { container } = render(<SkeletonHistoryList />);
    const list = container.firstElementChild!;
    expect(list.children).toHaveLength(6);
  });

  it('renders specified count of rows', () => {
    const { container } = render(<SkeletonHistoryList count={3} />);
    const list = container.firstElementChild!;
    expect(list.children).toHaveLength(3);
  });
});
