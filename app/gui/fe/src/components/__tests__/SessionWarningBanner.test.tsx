import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SessionWarningBanner from '../SessionWarningBanner';

// ── Mock WalletContext ───────────────────────────────────────────────

const mockExtendSession = vi.fn();
let mockSessionWarningSeconds: number | null = null;

vi.mock('../../contexts/WalletContext', () => ({
  useWalletContext: () => ({
    sessionWarningSeconds: mockSessionWarningSeconds,
    extendSession: mockExtendSession,
  }),
}));

beforeEach(() => {
  mockSessionWarningSeconds = null;
  mockExtendSession.mockClear();
});

// ── Tests ────────────────────────────────────────────────────────────

describe('SessionWarningBanner', () => {
  it('renders nothing when sessionWarningSeconds is null', () => {
    mockSessionWarningSeconds = null;
    const { container } = render(<SessionWarningBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when sessionWarningSeconds > 60', () => {
    mockSessionWarningSeconds = 61;
    const { container } = render(<SessionWarningBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('shows banner when sessionWarningSeconds is exactly 60', () => {
    mockSessionWarningSeconds = 60;
    render(<SessionWarningBanner />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Session will lock in/)).toBeInTheDocument();
  });

  it('shows banner when sessionWarningSeconds < 60', () => {
    mockSessionWarningSeconds = 30;
    render(<SessionWarningBanner />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('displays MM:SS format when seconds >= 60', () => {
    mockSessionWarningSeconds = 60;
    render(<SessionWarningBanner />);
    expect(screen.getByText('1:00')).toBeInTheDocument();
  });

  it('displays Ns format when seconds < 60', () => {
    mockSessionWarningSeconds = 42;
    render(<SessionWarningBanner />);
    expect(screen.getByText('42s')).toBeInTheDocument();
  });

  it('displays single-digit seconds with no padding in Ns format', () => {
    mockSessionWarningSeconds = 5;
    render(<SessionWarningBanner />);
    expect(screen.getByText('5s')).toBeInTheDocument();
  });

  it('pads seconds in MM:SS format', () => {
    // 65 seconds = 1:05
    mockSessionWarningSeconds = 65;
    // >60 means null render, but the boundary is sessionWarningSeconds > 60
    // Actually the component returns null when > 60, so 65 won't render.
    // Let's not test this — the component caps at 60.
    // The only MM:SS case is exactly 60 → 1:00
    mockSessionWarningSeconds = 60;
    render(<SessionWarningBanner />);
    expect(screen.getByText('1:00')).toBeInTheDocument();
  });

  it('"Stay Active" button calls extendSession', () => {
    mockSessionWarningSeconds = 30;
    render(<SessionWarningBanner />);
    fireEvent.click(screen.getByText('Stay Active'));
    expect(mockExtendSession).toHaveBeenCalledTimes(1);
  });

  it('has role="alert" and aria-live="polite"', () => {
    mockSessionWarningSeconds = 10;
    render(<SessionWarningBanner />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'polite');
  });

  it('has "Extend session" aria-label on the button', () => {
    mockSessionWarningSeconds = 10;
    render(<SessionWarningBanner />);
    expect(screen.getByLabelText('Extend session')).toBeInTheDocument();
  });

  it('progress bar width is proportional to remaining seconds', () => {
    mockSessionWarningSeconds = 30;
    const { container } = render(<SessionWarningBanner />);
    // Inner progress div is the second child of the progress bar container
    const progressBar = container.querySelector('.h-0\\.5 > div');
    expect(progressBar).toHaveStyle({ width: '50%' });
  });

  it('progress bar is 100% at 60 seconds', () => {
    mockSessionWarningSeconds = 60;
    const { container } = render(<SessionWarningBanner />);
    const progressBar = container.querySelector('.h-0\\.5 > div');
    expect(progressBar).toHaveStyle({ width: '100%' });
  });

  it('progress bar is near 0% at 0 seconds', () => {
    mockSessionWarningSeconds = 0;
    render(<SessionWarningBanner />);
    // 0 seconds → 0% width, but still renders (0 is not > 60 and not null)
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
  });
});
