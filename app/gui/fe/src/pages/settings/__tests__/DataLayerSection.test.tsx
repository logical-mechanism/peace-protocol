import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import DataLayerSection from '../DataLayerSection'

vi.mock('../../../services/iagonAuth', () => ({
  connectIagon: vi.fn(),
  disconnectIagon: vi.fn(),
  isIagonConnected: vi.fn().mockResolvedValue(true),
  getValidApiKey: vi.fn().mockResolvedValue('api-key'),
  getStoredApiKey: vi.fn().mockResolvedValue('api-key'),
}))

vi.mock('../../../services/iagonApi', () => ({
  verifyApiKey: vi.fn().mockResolvedValue(true),
  deleteFile: vi.fn(),
  getStorageUsage: vi.fn(),
}))

vi.mock('../../../services/listingDraftStorage', () => ({
  getOrphanedDrafts: vi.fn().mockResolvedValue([]),
  removeListingDraft: vi.fn(),
}))

const toastError = vi.fn()
const toastMock = {
  success: vi.fn(),
  error: toastError,
  warning: vi.fn(),
  info: vi.fn(),
  transactionSuccess: vi.fn(),
}
vi.mock('../../../components/Toast', () => ({
  useToast: () => toastMock,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../../../components/ConfirmModal', () => ({
  default: () => null,
}))

import { getStorageUsage } from '../../../services/iagonApi'

const mockGetStorageUsage = getStorageUsage as ReturnType<typeof vi.fn>

const renderSection = () =>
  render(
    <DataLayerSection
      wallet={null}
      address="addr_test"
      walletState="unlocked"
    />
  )

describe('DataLayerSection — Storage Usage card', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toastError.mockClear()
  })

  it('renders total bytes and file count when connected', async () => {
    mockGetStorageUsage.mockResolvedValueOnce({ totalBytes: 2_621_440, fileCount: 7 })
    renderSection()

    await waitFor(() => {
      expect(screen.getByText('Storage Usage')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByText('2.5 MB')).toBeInTheDocument()
      expect(screen.getByText('7')).toBeInTheDocument()
    })
    expect(mockGetStorageUsage).toHaveBeenCalledWith('api-key')
  })

  it('refreshes usage when the Refresh button is clicked', async () => {
    mockGetStorageUsage
      .mockResolvedValueOnce({ totalBytes: 1024, fileCount: 1 })
      .mockResolvedValueOnce({ totalBytes: 2048, fileCount: 2 })
    renderSection()

    await waitFor(() => {
      expect(screen.getByText('1.0 KB')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => {
      expect(screen.getByText('2.0 KB')).toBeInTheDocument()
    })
    expect(mockGetStorageUsage).toHaveBeenCalledTimes(2)
  })

  it('surfaces errors via toast without blocking the UI', async () => {
    mockGetStorageUsage.mockRejectedValueOnce(new Error('network down'))
    renderSection()

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Storage Usage', 'network down')
    })
    expect(screen.getByText('Storage Usage')).toBeInTheDocument()
  })
})
