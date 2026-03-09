import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import TransactionLink, { TransactionLinkInline } from '../TransactionLink';

const VALID_TX_HASH = 'a'.repeat(64);

vi.mock('../../utils/network', () => ({
  isValidTxHash: (hash: string) => /^[a-f0-9]{64}$/.test(hash),
  getTransactionUrl: (hash: string) => `https://cardanoscan.io/transaction/${hash}`,
}));

describe('TransactionLink', () => {
  it('renders a clickable link for valid tx hash', () => {
    render(<TransactionLink txHash={VALID_TX_HASH} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', `https://cardanoscan.io/transaction/${VALID_TX_HASH}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('truncates the hash by default', () => {
    render(<TransactionLink txHash={VALID_TX_HASH} />);
    const link = screen.getByRole('link');
    expect(link.textContent).toContain(`${VALID_TX_HASH.slice(0, 16)}...`);
  });

  it('shows full hash when truncate=false', () => {
    render(<TransactionLink txHash={VALID_TX_HASH} truncate={false} />);
    const link = screen.getByRole('link');
    expect(link.textContent).toContain(VALID_TX_HASH);
  });

  it('renders fallback span for invalid hash', () => {
    render(<TransactionLink txHash="not-a-hash" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(/not-a-hash/)).toBeInTheDocument();
  });

  it('renders "N/A" for empty hash', () => {
    render(<TransactionLink txHash="" />);
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });

  it('has title with full tx hash', () => {
    render(<TransactionLink txHash={VALID_TX_HASH} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('title', expect.stringContaining(VALID_TX_HASH));
  });
});

describe('TransactionLinkInline', () => {
  it('renders a clickable link for valid tx hash', () => {
    render(<TransactionLinkInline txHash={VALID_TX_HASH} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', `https://cardanoscan.io/transaction/${VALID_TX_HASH}`);
  });

  it('shows truncated hash (first 8 + last 8)', () => {
    render(<TransactionLinkInline txHash={VALID_TX_HASH} />);
    const link = screen.getByRole('link');
    expect(link.textContent).toContain(`${VALID_TX_HASH.slice(0, 8)}...${VALID_TX_HASH.slice(-8)}`);
  });

  it('renders fallback span for invalid hash', () => {
    render(<TransactionLinkInline txHash="bad" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('bad')).toBeInTheDocument();
  });

  it('renders "N/A" for empty hash', () => {
    render(<TransactionLinkInline txHash="" />);
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });
});
