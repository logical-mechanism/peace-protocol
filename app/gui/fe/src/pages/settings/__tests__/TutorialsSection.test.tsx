import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

describe('TutorialsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOnboardingState.mockReturnValue({
      step: 3,
      completed: true,
      firstListingCompleted: false,
      firstBidCompleted: false,
      firstDecryptCompleted: false,
    })
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
    })
    render(<TutorialsSection />)
    const badges = screen.getAllByText('Completed')
    expect(badges.length).toBeGreaterThanOrEqual(1)
  })

  it('shows Start buttons for incomplete flows with navigation', () => {
    render(<TutorialsSection />)
    const starts = screen.getAllByText('Start')
    expect(starts.length).toBe(3) // first-listing + first-bid + first-decrypt
  })

  it('shows Replay button for completed flow with navigation', () => {
    mockGetOnboardingState.mockReturnValue({
      step: 3,
      completed: true,
      firstListingCompleted: true,
      firstBidCompleted: false,
      firstDecryptCompleted: false,
    })
    render(<TutorialsSection />)
    expect(screen.getByText('Replay')).toBeInTheDocument()
  })

  it('shows Coming soon for flows without navigation', () => {
    render(<TutorialsSection />)
    const comingSoon = screen.getAllByText('Coming soon')
    expect(comingSoon.length).toBeGreaterThanOrEqual(1)
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
      state: { tab: 'my-purchases' },
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
