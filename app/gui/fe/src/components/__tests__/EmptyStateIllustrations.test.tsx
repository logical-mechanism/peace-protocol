import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  MarketplaceEmptyIllustration,
  NoResultsIllustration,
  NoPurchasesIllustration,
  NoSalesIllustration,
  LibraryEmptyIllustration,
  HistoryEmptyIllustration,
} from '../EmptyStateIllustrations';

const illustrations = [
  { name: 'MarketplaceEmptyIllustration', Component: MarketplaceEmptyIllustration },
  { name: 'NoResultsIllustration', Component: NoResultsIllustration },
  { name: 'NoPurchasesIllustration', Component: NoPurchasesIllustration },
  { name: 'NoSalesIllustration', Component: NoSalesIllustration },
  { name: 'LibraryEmptyIllustration', Component: LibraryEmptyIllustration },
  { name: 'HistoryEmptyIllustration', Component: HistoryEmptyIllustration },
];

describe('EmptyStateIllustrations', () => {
  for (const { name, Component } of illustrations) {
    describe(name, () => {
      it('renders an SVG element', () => {
        const { container } = render(<Component />);
        expect(container.querySelector('svg')).not.toBeNull();
      });

      it('has viewBox="0 0 80 80"', () => {
        const { container } = render(<Component />);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('viewBox')).toBe('0 0 80 80');
      });

      it('has consistent sizing class w-20 h-20', () => {
        const { container } = render(<Component />);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('class')).toContain('w-20');
        expect(svg.getAttribute('class')).toContain('h-20');
      });

      it('has fill="none" on root SVG', () => {
        const { container } = render(<Component />);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('fill')).toBe('none');
      });

      it('uses var(--text-muted) CSS variable for theming', () => {
        const { container } = render(<Component />);
        const html = container.innerHTML;
        expect(html).toContain('var(--text-muted)');
      });

      it('uses var(--accent) or var(--accent-muted) CSS variable', () => {
        const { container } = render(<Component />);
        const html = container.innerHTML;
        const usesAccent = html.includes('var(--accent)') || html.includes('var(--accent-muted)');
        expect(usesAccent).toBe(true);
      });
    });
  }
});
