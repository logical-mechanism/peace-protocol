import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import OnboardingOverlay from '../OnboardingOverlay';
import type { OnboardingState } from '../../services/onboardingStorage';

// ── Mocks ───────────────────────────────────────────────────────────

const mockGetOnboardingState = vi.fn<() => OnboardingState>();
const mockAdvanceOnboardingStep = vi.fn<() => OnboardingState>();
const mockCompleteOnboarding = vi.fn();

vi.mock('../../services/onboardingStorage', () => ({
  getOnboardingState: () => mockGetOnboardingState(),
  advanceOnboardingStep: () => mockAdvanceOnboardingStep(),
  completeOnboarding: () => mockCompleteOnboarding(),
}));

let mockPathname = '/wallet-setup';
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mockPathname }),
}));

// ── Helpers ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockPathname = '/wallet-setup';
  mockGetOnboardingState.mockReturnValue({ step: 0, completed: false, firstListingCompleted: false, firstBidCompleted: false, firstDecryptCompleted: false });
  mockAdvanceOnboardingStep.mockReturnValue({ step: 1, completed: false, firstListingCompleted: false, firstBidCompleted: false, firstDecryptCompleted: false });
});

// ── Tests ───────────────────────────────────────────────────────────

describe('OnboardingOverlay', () => {
  it('renders first step when on matching route', () => {
    render(<OnboardingOverlay />);
    expect(screen.getByText('Create Your Wallet')).toBeInTheDocument();
    expect(screen.getByText(/Welcome to Veiled/)).toBeInTheDocument();
  });

  it('shows step counter', () => {
    render(<OnboardingOverlay />);
    expect(screen.getByText('1 / 4')).toBeInTheDocument();
  });

  it('renders 4 step indicator dots', () => {
    const { container } = render(<OnboardingOverlay />);
    const dots = container.querySelectorAll('.h-1\\.5.rounded-full');
    expect(dots).toHaveLength(4);
  });

  it('shows "Next" button on non-last step', () => {
    render(<OnboardingOverlay />);
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  it('advances step on Next click', () => {
    render(<OnboardingOverlay />);
    fireEvent.click(screen.getByText('Next'));
    expect(mockAdvanceOnboardingStep).toHaveBeenCalledOnce();
  });

  it('shows "Skip tour" button', () => {
    render(<OnboardingOverlay />);
    expect(screen.getByText('Skip tour')).toBeInTheDocument();
  });

  it('completes onboarding on Skip click', () => {
    render(<OnboardingOverlay />);
    fireEvent.click(screen.getByText('Skip tour'));
    expect(mockCompleteOnboarding).toHaveBeenCalledOnce();
  });

  it('does not render when completed', () => {
    mockGetOnboardingState.mockReturnValue({ step: 0, completed: true, firstListingCompleted: false, firstBidCompleted: false, firstDecryptCompleted: false });
    const { container } = render(<OnboardingOverlay />);
    expect(container.innerHTML).toBe('');
  });

  it('does not render when route does not match current step', () => {
    mockPathname = '/dashboard'; // Step 0 expects /wallet-setup
    const { container } = render(<OnboardingOverlay />);
    expect(container.innerHTML).toBe('');
  });

  it('renders step 2 content on /node-sync route', () => {
    mockGetOnboardingState.mockReturnValue({ step: 1, completed: false, firstListingCompleted: false, firstBidCompleted: false, firstDecryptCompleted: false });
    mockPathname = '/node-sync';
    render(<OnboardingOverlay />);
    expect(screen.getByText('Sync With the Blockchain')).toBeInTheDocument();
    expect(screen.getByText('2 / 4')).toBeInTheDocument();
  });

  it('shows "Done" button on last step', () => {
    mockGetOnboardingState.mockReturnValue({ step: 3, completed: false, firstListingCompleted: false, firstBidCompleted: false, firstDecryptCompleted: false });
    mockPathname = '/dashboard';
    mockAdvanceOnboardingStep.mockReturnValue({ step: 3, completed: true, firstListingCompleted: false, firstBidCompleted: false, firstDecryptCompleted: false });
    render(<OnboardingOverlay />);
    expect(screen.getByText('Done')).toBeInTheDocument();
  });
});
