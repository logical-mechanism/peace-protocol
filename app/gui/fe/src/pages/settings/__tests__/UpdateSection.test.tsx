import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import UpdateSection from '../UpdateSection'
import { UpdateProvider } from '../../../contexts/UpdateContext'
import { ModalProvider } from '../../../contexts/ModalContext'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Mock } from 'vitest'

// Mock Toast to avoid rendering the full toast system
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    toasts: [],
    queuedCount: 0,
    removeToast: vi.fn(),
    dismissAll: vi.fn(),
  }),
}))

let progressHandler: ((event: { payload: { downloaded_bytes: number; total_bytes: number; percent: number; bytes_per_sec: number } }) => void) | undefined

function renderUpdateSection() {
  return render(
    <ModalProvider>
      <UpdateProvider>
        <UpdateSection />
      </UpdateProvider>
    </ModalProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  progressHandler = undefined
  ;(listen as Mock).mockImplementation((_event, handler) => {
    progressHandler = handler
    return Promise.resolve(vi.fn())
  })
  ;(invoke as Mock).mockImplementation((cmd: string) => {
    if (cmd === 'get_current_version') return Promise.resolve('0.4.2')
    return Promise.reject(new Error(`unmocked command: ${cmd}`))
  })
})

describe('UpdateSection', () => {
  it('displays current version', async () => {
    renderUpdateSection()

    await waitFor(() => {
      expect(screen.getByText('v0.4.2')).toBeInTheDocument()
    })
    expect(invoke).toHaveBeenCalledWith('get_current_version')
  })

  it('renders the Check for Updates button', () => {
    renderUpdateSection()
    expect(screen.getByText('Check for Updates')).toBeInTheDocument()
  })

  it('passes download_size as expectedSize when downloading', async () => {
    ;(invoke as Mock).mockImplementation((cmd: string) => {
      if (cmd === 'get_current_version') return Promise.resolve('0.4.2')
      if (cmd === 'check_for_update') return Promise.resolve({
        current_version: '0.4.2',
        latest_version: '0.4.3',
        update_available: true,
        download_url: 'https://github.com/logical-mechanism/peace-protocol/releases/download/v0.4.3/Veiled_0.4.3_amd64.AppImage',
        release_notes: '',
        published_at: '',
        download_size: 600_000_000,
      })
      if (cmd === 'download_update') return new Promise(() => {})
      return Promise.reject(new Error(`unmocked: ${cmd}`))
    })

    renderUpdateSection()

    fireEvent.click(screen.getByText('Check for Updates'))
    await waitFor(() => {
      expect(screen.getByText('Download Update')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Download Update'))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('download_update', {
        downloadUrl: 'https://github.com/logical-mechanism/peace-protocol/releases/download/v0.4.3/Veiled_0.4.3_amd64.AppImage',
        expectedSize: 600_000_000,
      })
    })
  })

  it('renders speed and ETA when bytes_per_sec is positive', async () => {
    ;(invoke as Mock).mockImplementation((cmd: string) => {
      if (cmd === 'get_current_version') return Promise.resolve('0.4.2')
      if (cmd === 'check_for_update') return Promise.resolve({
        current_version: '0.4.2',
        latest_version: '0.4.3',
        update_available: true,
        download_url: 'https://github.com/logical-mechanism/peace-protocol/releases/download/v0.4.3/Veiled_0.4.3_amd64.AppImage',
        release_notes: '',
        published_at: '',
        download_size: 600_000_000,
      })
      if (cmd === 'download_update') return new Promise(() => {})
      return Promise.reject(new Error(`unmocked: ${cmd}`))
    })

    renderUpdateSection()

    fireEvent.click(screen.getByText('Check for Updates'))
    await waitFor(() => expect(screen.getByText('Download Update')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Download Update'))

    await waitFor(() => expect(screen.getByText('Downloading update...')).toBeInTheDocument())
    expect(progressHandler).toBeDefined()

    act(() => {
      progressHandler?.({
        payload: {
          downloaded_bytes: 60_000_000,
          total_bytes: 600_000_000,
          percent: 10,
          // 10 MiB/s → ETA for remaining 540 MB ≈ 51s → "00:51"
          bytes_per_sec: 10 * 1024 * 1024,
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByText('10.0 MB/s')).toBeInTheDocument()
    })
    expect(screen.getByText('ETA 00:51')).toBeInTheDocument()
  })

  it('hides speed and ETA when bytes_per_sec is zero', async () => {
    ;(invoke as Mock).mockImplementation((cmd: string) => {
      if (cmd === 'get_current_version') return Promise.resolve('0.4.2')
      if (cmd === 'check_for_update') return Promise.resolve({
        current_version: '0.4.2',
        latest_version: '0.4.3',
        update_available: true,
        download_url: 'https://github.com/logical-mechanism/peace-protocol/releases/download/v0.4.3/Veiled_0.4.3_amd64.AppImage',
        release_notes: '',
        published_at: '',
        download_size: 600_000_000,
      })
      if (cmd === 'download_update') return new Promise(() => {})
      return Promise.reject(new Error(`unmocked: ${cmd}`))
    })

    renderUpdateSection()

    fireEvent.click(screen.getByText('Check for Updates'))
    await waitFor(() => expect(screen.getByText('Download Update')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Download Update'))
    await waitFor(() => expect(screen.getByText('Downloading update...')).toBeInTheDocument())

    expect(screen.queryByText(/MB\/s/)).toBeNull()
    expect(screen.queryByText(/ETA /)).toBeNull()
  })

  it('shows up-to-date message when no update available', async () => {
    ;(invoke as Mock).mockImplementation((cmd: string) => {
      if (cmd === 'get_current_version') return Promise.resolve('0.4.2')
      if (cmd === 'check_for_update') return Promise.resolve({
        current_version: '0.4.2',
        latest_version: '0.4.2',
        update_available: false,
        download_url: '',
        release_notes: '',
        published_at: '',
        download_size: null,
      })
      return Promise.reject(new Error(`unmocked: ${cmd}`))
    })

    renderUpdateSection()

    fireEvent.click(screen.getByText('Check for Updates'))

    await waitFor(() => {
      expect(screen.getByText("You're on the latest version")).toBeInTheDocument()
    })
  })

  it('shows update available with version and download button', async () => {
    ;(invoke as Mock).mockImplementation((cmd: string) => {
      if (cmd === 'get_current_version') return Promise.resolve('0.4.2')
      if (cmd === 'check_for_update') return Promise.resolve({
        current_version: '0.4.2',
        latest_version: '0.4.3',
        update_available: true,
        download_url: 'https://github.com/logical-mechanism/peace-protocol/releases/download/v0.4.3/Veiled_0.4.3_amd64.AppImage',
        release_notes: 'New features',
        published_at: '2026-03-15T00:00:00Z',
        download_size: 600000000,
      })
      return Promise.reject(new Error(`unmocked: ${cmd}`))
    })

    renderUpdateSection()

    fireEvent.click(screen.getByText('Check for Updates'))

    await waitFor(() => {
      expect(screen.getByText('Update available: v0.4.3')).toBeInTheDocument()
    })
    expect(screen.getByText('Download Update')).toBeInTheDocument()
    expect(screen.getByText('New features')).toBeInTheDocument()
    expect(screen.getByText('572.2 MB')).toBeInTheDocument()
  })

  it('expands release notes into a modal when "Expand" is clicked', async () => {
    ;(invoke as Mock).mockImplementation((cmd: string) => {
      if (cmd === 'get_current_version') return Promise.resolve('0.4.2')
      if (cmd === 'check_for_update') return Promise.resolve({
        current_version: '0.4.2',
        latest_version: '0.4.3',
        update_available: true,
        download_url: 'https://github.com/logical-mechanism/peace-protocol/releases/download/v0.4.3/Veiled_0.4.3_amd64.AppImage',
        release_notes: 'New features',
        published_at: '2026-03-15T00:00:00Z',
        download_size: 600000000,
      })
      return Promise.reject(new Error(`unmocked: ${cmd}`))
    })

    renderUpdateSection()

    fireEvent.click(screen.getByText('Check for Updates'))
    await waitFor(() => expect(screen.getByText('Expand')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Expand'))

    // Modal title and version stamp render in the dialog
    await waitFor(() => expect(screen.getByText('Release notes')).toBeInTheDocument())
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'release-notes-modal-title')
  })

  it('shows error state with retry button', async () => {
    ;(invoke as Mock).mockImplementation((cmd: string) => {
      if (cmd === 'get_current_version') return Promise.resolve('0.4.2')
      if (cmd === 'check_for_update') return Promise.reject('GitHub API rate limit reached')
      return Promise.reject(new Error(`unmocked: ${cmd}`))
    })

    renderUpdateSection()

    fireEvent.click(screen.getByText('Check for Updates'))

    await waitFor(() => {
      expect(screen.getByText('GitHub API rate limit reached')).toBeInTheDocument()
    })
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('shows downloading progress state', async () => {
    ;(invoke as Mock).mockImplementation((cmd: string) => {
      if (cmd === 'get_current_version') return Promise.resolve('0.4.2')
      if (cmd === 'check_for_update') return Promise.resolve({
        current_version: '0.4.2',
        latest_version: '0.4.3',
        update_available: true,
        download_url: 'https://github.com/logical-mechanism/peace-protocol/releases/download/v0.4.3/Veiled_0.4.3_amd64.AppImage',
        release_notes: '',
        published_at: '',
        download_size: null,
      })
      if (cmd === 'download_update') return new Promise(() => {})
      return Promise.reject(new Error(`unmocked: ${cmd}`))
    })

    renderUpdateSection()

    fireEvent.click(screen.getByText('Check for Updates'))

    await waitFor(() => {
      expect(screen.getByText('Download Update')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Download Update'))

    await waitFor(() => {
      expect(screen.getByText('Downloading update...')).toBeInTheDocument()
    })
  })

  it('shows downloaded state with file path', async () => {
    const downloadPath = '/home/user/Veiled_0.4.3_amd64.AppImage'
    ;(invoke as Mock).mockImplementation((cmd: string) => {
      if (cmd === 'get_current_version') return Promise.resolve('0.4.2')
      if (cmd === 'check_for_update') return Promise.resolve({
        current_version: '0.4.2',
        latest_version: '0.4.3',
        update_available: true,
        download_url: 'https://github.com/logical-mechanism/peace-protocol/releases/download/v0.4.3/Veiled_0.4.3_amd64.AppImage',
        release_notes: '',
        published_at: '',
        download_size: null,
      })
      if (cmd === 'download_update') return Promise.resolve(downloadPath)
      return Promise.reject(new Error(`unmocked: ${cmd}`))
    })

    renderUpdateSection()

    fireEvent.click(screen.getByText('Check for Updates'))

    await waitFor(() => {
      expect(screen.getByText('Download Update')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Download Update'))

    await waitFor(() => {
      expect(screen.getByText('Update downloaded')).toBeInTheDocument()
    })
    expect(screen.getByText(`Saved to: ${downloadPath}`)).toBeInTheDocument()
    expect(screen.getByText('Close and reopen the app to use the new version.')).toBeInTheDocument()
  })
})
