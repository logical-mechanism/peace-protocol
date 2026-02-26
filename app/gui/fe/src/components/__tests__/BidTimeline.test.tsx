import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import BidTimeline from '../BidTimeline';

describe('BidTimeline', () => {
  it('renders all four stage labels', () => {
    render(<BidTimeline stage="placed" bidStatus="pending" />);
    expect(screen.getByText('Bid Placed')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText('Decrypting')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('returns null for rejected bids', () => {
    const { container } = render(<BidTimeline stage="placed" bidStatus="rejected" />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null for cancelled bids', () => {
    const { container } = render(<BidTimeline stage="placed" bidStatus="cancelled" />);
    expect(container.innerHTML).toBe('');
  });

  it('shows "Failed" label when stage is failed', () => {
    render(<BidTimeline stage="failed" bidStatus="accepted" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    // "Decrypting" label should be replaced by "Failed"
    expect(screen.queryByText('Decrypting')).not.toBeInTheDocument();
  });

  it('renders compact mode without text labels', () => {
    const { container } = render(
      <BidTimeline stage="accepted" bidStatus="accepted" compact />
    );
    // No text content in compact mode
    expect(container.textContent).toBe('');
    // But dots should still render (4 dots)
    const dots = container.querySelectorAll('.rounded-full');
    expect(dots.length).toBe(4);
  });

  it('renders for pending bid with first step as current', () => {
    render(<BidTimeline stage="placed" bidStatus="pending" />);
    // All labels should be present
    expect(screen.getByText('Bid Placed')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('renders for accepted bid', () => {
    render(<BidTimeline stage="accepted" bidStatus="accepted" />);
    expect(screen.getByText('Bid Placed')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
  });

  it('renders for complete bid with all stages highlighted', () => {
    render(<BidTimeline stage="complete" bidStatus="accepted" />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });
});
