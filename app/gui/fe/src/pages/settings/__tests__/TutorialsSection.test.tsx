import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import TutorialsSection from '../TutorialsSection'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

const mockGetOnboardingState = vi.fn()
const mockResetTutorials = vi.fn()
const mockResetTutorialFlag = vi.fn()
vi.mock('../../../services/onboardingStorage', () => ({
  getOnboardingState: (...args: unknown[]) => mockGetOnboardingState(...args),
  resetTutorials: (...args: unknown[]) => mockResetTutorials(...args),
  resetTutorialFlag: (...args: unknown[]) => mockResetTutorialFlag(...args),
}))

const mockIsIagonConnected = vi.fn()
vi.mock('../../../services/iagonAuth', () => ({
  isIagonConnected: (...args: unknown[]) => mockIsIagonConnected(...args),
  onIagonAuthFailure: vi.fn().mockReturnValue(() => {}),
}))

describe('TutorialsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOnboardingState.mockReturnValue({
      step: 3,
      completed: true,
      firstListingCompleted: false,
      firstBidCompleted: false,
      firstDecryptCompleted: false,
      firstBidAcceptedCompleted: false,
      iagonPrimerCompleted: false,
    })
    mockIsIagonConnected.mockResolvedValue(false)
  })

  it('renders tutorial flow rows and keyboard shortcuts', () => {
    render(<TutorialsSection />)
    expect(screen.getByText('Create Your First Listing')).toBeInTheDocument()
    expect(screen.getByText('Place Your First Bid')).toBeInTheDocument()
    expect(screen.getByText('Decrypt a Purchase')).toBeInTheDocument()
    expect(screen.getByText('Accept a Bid (Seller)')).toBeInTheDocument()
    expect(screen.getByText('Iagon Storage Setup')).toBeInTheDocument()
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
  })

  it('shows Not started status when tutorials not completed', () => {
    render(<TutorialsSection />)
    const badges = screen.getAllByText('Not started')
    expect(badges.length).toBeGreaterThanOrEqual(1)
  })

  it('shows Completed status when tutorial is completed', () => {
    mockGetOnboardingState.mockReturnValue({
      step: 3,
      completed: true,
      firstListingCompleted: true,
      firstBidCompleted: true,
      firstDecryptCompleted: true,
      firstBidAcceptedCompleted: true,
      iagonPrimerCompleted: true,
    })
    render(<TutorialsSection />)
    const badges = screen.getAllByText('Completed')
    expect(badges.length).toBeGreaterThanOrEqual(1)
  })

  it('shows Start buttons for every tutorial flow', () => {
    render(<TutorialsSection />)
    const starts = screen.getAllByText('Start')
    expect(starts.length).toBe(5) // first-listing + first-bid + first-decrypt + first-bid-accepted + iagon-primer
  })

  it('shows Replay button for completed flow with navigation', () => {
    mockGetOnboardingState.mockReturnValue({
      step: 3,
      completed: true,
      firstListingCompleted: true,
      firstBidCompleted: false,
      firstDecryptCompleted: false,
      firstBidAcceptedCompleted: false,
      iagonPrimerCompleted: false,
    })
    render(<TutorialsSection />)
    expect(screen.getByText('Replay')).toBeInTheDocument()
  })

  it('derives iagon-primer completion from the live connection state', async () => {
    mockIsIagonConnected.mockResolvedValue(true)
    mockGetOnboardingState.mockReturnValue({
      step: 3,
      completed: true,
      firstListingCompleted: false,
      firstBidCompleted: false,
      firstDecryptCompleted: false,
      firstBidAcceptedCompleted: false,
      iagonPrimerCompleted: false, // stored flag says Not started
    })
    render(<TutorialsSection />)
    // Only the iagon-primer row should show Completed despite the stored
    // flag being false — the live connection wins for this row.
    await waitFor(() => {
      expect(screen.getByText('Completed')).toBeInTheDocument()
    })
  })

  it('iagon-primer row shows Not started when the key is not connected', async () => {
    mockIsIagonConnected.mockResolvedValue(false)
    mockGetOnboardingState.mockReturnValue({
      step: 3,
      completed: true,
      firstListingCompleted: false,
      firstBidCompleted: false,
      firstDecryptCompleted: false,
      firstBidAcceptedCompleted: false,
      iagonPrimerCompleted: true, // stored flag says Completed
    })
    render(<TutorialsSection />)
    // Even though the stored flag is true, the live connection check wins.
    await waitFor(() => {
      expect(screen.queryByText('Completed')).not.toBeInTheDocument()
    })
  })

  it('does not render Coming soon once every flow has navigation wired up', () => {
    render(<TutorialsSection />)
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument()
  })

  it('resets only first-listing flag and navigates on first-listing Start click', () => {
    render(<TutorialsSection />)
    const starts = screen.getAllByText('Start')
    fireEvent.click(starts[0]) // first-listing Start button
    expect(mockResetTutorialFlag).toHaveBeenCalledWith('firstListingCompleted')
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', {
      state: { tab: 'marketplace', startTutorial: 'first-listing' },
    })
  })

  it('resets only first-bid flag and navigates on first-bid Start click', () => {
    render(<TutorialsSection />)
    const starts = screen.getAllByText('Start')
    fireEvent.click(starts[1]) // first-bid Start button
    expect(mockResetTutorialFlag).toHaveBeenCalledWith('firstBidCompleted')
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', {
      state: { tab: 'marketplace' },
    })
  })

  it('resets only first-decrypt flag and navigates on first-decrypt Start click', () => {
    render(<TutorialsSection />)
    const starts = screen.getAllByText('Start')
    fireEvent.click(starts[2]) // first-decrypt Start button
    expect(mockResetTutorialFlag).toHaveBeenCalledWith('firstDecryptCompleted')
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', {
      state: { tab: 'my-purchases', startTutorial: 'first-decrypt' },
    })
  })

  it('resets only first-bid-accepted flag and navigates to my-sales on Start click', () => {
    render(<TutorialsSection />)
    const starts = screen.getAllByText('Start')
    fireEvent.click(starts[3]) // first-bid-accepted Start button
    expect(mockResetTutorialFlag).toHaveBeenCalledWith('firstBidAcceptedCompleted')
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', {
      state: { tab: 'my-sales', startTutorial: 'first-bid-accepted' },
    })
  })

  it('resets only iagon-primer flag and navigates to Settings → Data Layer on Start click', () => {
    render(<TutorialsSection />)
    const starts = screen.getAllByText('Start')
    fireEvent.click(starts[4]) // iagon-primer Start button
    expect(mockResetTutorialFlag).toHaveBeenCalledWith('iagonPrimerCompleted')
    expect(mockNavigate).toHaveBeenCalledWith('/settings', {
      state: { section: 'datalayer' },
    })
  })

  it('Reset All button calls resetTutorials', () => {
    render(<TutorialsSection />)
    fireEvent.click(screen.getByText('Reset All'))
    expect(mockResetTutorials).toHaveBeenCalled()
  })

  it('Reset All button disables after click', () => {
    render(<TutorialsSection />)
    const btn = screen.getByText('Reset All')
    fireEvent.click(btn)
    expect(screen.getByText('All Reset')).toBeInTheDocument()
  })

  it('renders keyboard shortcut keys from the shared source', () => {
    render(<TutorialsSection />)
    expect(screen.getByText('Ctrl + R')).toBeInTheDocument()
    expect(screen.getByText('Ctrl + K')).toBeInTheDocument()
    expect(screen.getByText('Esc')).toBeInTheDocument()
    expect(screen.getByText('?')).toBeInTheDocument()
  })
})
