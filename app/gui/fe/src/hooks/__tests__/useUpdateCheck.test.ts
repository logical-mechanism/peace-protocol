import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { StrictMode } from 'react'
import { useUpdateCheck, type UpdateInfo } from '../useUpdateCheck'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Mock } from 'vitest'

const MOCK_UPDATE_INFO: UpdateInfo = {
  current_version: '0.4.2',
  latest_version: '0.4.3',
  update_available: true,
  download_url: 'https://github.com/logical-mechanism/peace-protocol/releases/download/v0.4.3/Veiled_0.4.3_amd64.AppImage',
  release_notes: 'Bug fixes and improvements',
  published_at: '2026-03-15T00:00:00Z',
  download_size: 600000000,
}

const MOCK_NO_UPDATE: UpdateInfo = {
  ...MOCK_UPDATE_INFO,
  latest_version: '0.4.2',
  update_available: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  ;(listen as Mock).mockResolvedValue(vi.fn())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useUpdateCheck', () => {
  it('starts in idle state', () => {
    const { result } = renderHook(() => useUpdateCheck())
    expect(result.current.state.status).toBe('idle')
  })

  it('checkForUpdate sets state to available when update exists', async () => {
    ;(invoke as Mock).mockResolvedValueOnce(MOCK_UPDATE_INFO)

    const { result } = renderHook(() => useUpdateCheck())

    await act(async () => {
      await result.current.checkForUpdate()
    })

    expect(result.current.state.status).toBe('available')
    if (result.current.state.status === 'available') {
      expect(result.current.state.info.latest_version).toBe('0.4.3')
    }
    expect(invoke).toHaveBeenCalledWith('check_for_update')
  })

  it('checkForUpdate sets state to up-to-date when no update', async () => {
    ;(invoke as Mock).mockResolvedValueOnce(MOCK_NO_UPDATE)

    const { result } = renderHook(() => useUpdateCheck())

    await act(async () => {
      await result.current.checkForUpdate()
    })

    expect(result.current.state.status).toBe('up-to-date')
  })

  it('checkForUpdate sets error state on failure', async () => {
    ;(invoke as Mock).mockRejectedValueOnce('Network error')

    const { result } = renderHook(() => useUpdateCheck())

    await act(async () => {
      await result.current.checkForUpdate()
    })

    expect(result.current.state.status).toBe('error')
    if (result.current.state.status === 'error') {
      expect(result.current.state.message).toBe('Network error')
    }
  })

  it('downloadUpdate transitions through downloading to downloaded', async () => {
    ;(invoke as Mock).mockResolvedValueOnce('/home/user/Veiled_0.4.3_amd64.AppImage')

    const { result } = renderHook(() => useUpdateCheck())

    let downloadPromise: Promise<string | null>
    act(() => {
      downloadPromise = result.current.downloadUpdate(MOCK_UPDATE_INFO.download_url)
    })

    expect(result.current.state.status).toBe('downloading')

    await act(async () => {
      await downloadPromise!
    })

    expect(result.current.state.status).toBe('downloaded')
    if (result.current.state.status === 'downloaded') {
      expect(result.current.state.filePath).toBe('/home/user/Veiled_0.4.3_amd64.AppImage')
    }
    expect(invoke).toHaveBeenCalledWith('download_update', {
      downloadUrl: MOCK_UPDATE_INFO.download_url,
      expectedSize: null,
    })
  })

  it('downloadUpdate passes expectedSize through to invoke', async () => {
    ;(invoke as Mock).mockResolvedValueOnce('/home/user/Veiled_0.4.3_amd64.AppImage')

    const { result } = renderHook(() => useUpdateCheck())

    await act(async () => {
      await result.current.downloadUpdate(MOCK_UPDATE_INFO.download_url, 600_000_000)
    })

    expect(invoke).toHaveBeenCalledWith('download_update', {
      downloadUrl: MOCK_UPDATE_INFO.download_url,
      expectedSize: 600_000_000,
    })
  })

  it('downloadUpdate seeds total_bytes from expectedSize before first progress event', async () => {
    let resolveDownload!: (value: string) => void
    ;(invoke as Mock).mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveDownload = resolve
      }),
    )

    const { result } = renderHook(() => useUpdateCheck())

    act(() => {
      void result.current.downloadUpdate(MOCK_UPDATE_INFO.download_url, 600_000_000)
    })

    // Pre-event state: percent=0, but total_bytes already reflects expected size
    // so the UI doesn't render "0 / 0 B" until the first event arrives.
    expect(result.current.state.status).toBe('downloading')
    if (result.current.state.status === 'downloading') {
      expect(result.current.state.progress.total_bytes).toBe(600_000_000)
      expect(result.current.state.progress.bytes_per_sec).toBe(0)
    }

    await act(async () => {
      resolveDownload('/path')
    })
  })

  it('cancelDownload invokes the Rust cancel command', async () => {
    ;(invoke as Mock).mockResolvedValueOnce(undefined)

    const { result } = renderHook(() => useUpdateCheck())

    await act(async () => {
      await result.current.cancelDownload()
    })

    expect(invoke).toHaveBeenCalledWith('cancel_update_download')
  })

  it('downloadUpdate restores to available state when download is cancelled', async () => {
    // First a check so the hook has the available info to restore.
    ;(invoke as Mock).mockResolvedValueOnce(MOCK_UPDATE_INFO)
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => {
      await result.current.checkForUpdate()
    })
    expect(result.current.state.status).toBe('available')

    // Now download_update rejects with the cancel sentinel.
    ;(invoke as Mock).mockRejectedValueOnce('cancelled')
    await act(async () => {
      await result.current.downloadUpdate(MOCK_UPDATE_INFO.download_url)
    })

    expect(result.current.state.status).toBe('available')
    if (result.current.state.status === 'available') {
      expect(result.current.state.info.latest_version).toBe('0.4.3')
    }
  })

  it('downloadUpdate falls back to idle on cancel when no prior available info', async () => {
    ;(invoke as Mock).mockRejectedValueOnce('cancelled')

    const { result } = renderHook(() => useUpdateCheck())

    await act(async () => {
      await result.current.downloadUpdate(MOCK_UPDATE_INFO.download_url)
    })

    expect(result.current.state.status).toBe('idle')
  })

  it('downloadUpdate sets error state on failure', async () => {
    ;(invoke as Mock).mockRejectedValueOnce('Disk full')

    const { result } = renderHook(() => useUpdateCheck())

    await act(async () => {
      await result.current.downloadUpdate(MOCK_UPDATE_INFO.download_url)
    })

    expect(result.current.state.status).toBe('error')
    if (result.current.state.status === 'error') {
      expect(result.current.state.message).toBe('Disk full')
    }
  })

  it('progress event payload populates bytes_per_sec', async () => {
    let progressHandler: ((event: { payload: { downloaded_bytes: number; total_bytes: number; percent: number; bytes_per_sec: number } }) => void) | undefined
    ;(listen as Mock).mockImplementationOnce((_event, handler) => {
      progressHandler = handler
      return Promise.resolve(vi.fn())
    })
    let resolveDownload!: (value: string) => void
    ;(invoke as Mock).mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveDownload = resolve
      }),
    )

    const { result } = renderHook(() => useUpdateCheck())

    act(() => {
      void result.current.downloadUpdate(MOCK_UPDATE_INFO.download_url)
    })

    // Wait a tick for the listen() promise to resolve and register the handler.
    await act(async () => {
      await Promise.resolve()
    })

    expect(progressHandler).toBeDefined()
    act(() => {
      progressHandler?.({
        payload: {
          downloaded_bytes: 50_000_000,
          total_bytes: 600_000_000,
          percent: 8.33,
          bytes_per_sec: 5_000_000,
        },
      })
    })

    if (result.current.state.status === 'downloading') {
      expect(result.current.state.progress.bytes_per_sec).toBe(5_000_000)
      expect(result.current.state.progress.percent).toBeCloseTo(8.33)
    } else {
      throw new Error(`expected downloading state, got ${result.current.state.status}`)
    }

    await act(async () => {
      resolveDownload('/path')
    })
  })

  it('dismiss sets state to dismissed', async () => {
    ;(invoke as Mock).mockResolvedValueOnce(MOCK_UPDATE_INFO)

    const { result } = renderHook(() => useUpdateCheck())

    await act(async () => {
      await result.current.checkForUpdate()
    })
    expect(result.current.state.status).toBe('available')

    act(() => {
      result.current.dismiss()
    })
    expect(result.current.state.status).toBe('dismissed')
  })

  it('reset returns to idle state', async () => {
    ;(invoke as Mock).mockRejectedValueOnce('error')

    const { result } = renderHook(() => useUpdateCheck())

    await act(async () => {
      await result.current.checkForUpdate()
    })
    expect(result.current.state.status).toBe('error')

    act(() => {
      result.current.reset()
    })
    expect(result.current.state.status).toBe('idle')
  })

  it('auto-checks on mount when autoCheck is true', async () => {
    ;(invoke as Mock).mockResolvedValueOnce(MOCK_UPDATE_INFO)

    renderHook(() => useUpdateCheck(true))

    // Advance past the 3s setTimeout delay
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    // Wait for the async invoke to complete
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(invoke).toHaveBeenCalledWith('check_for_update')
  })

  it('auto-checks under React.StrictMode (effect setup → cleanup → setup must still fire timer)', async () => {
    ;(invoke as Mock).mockResolvedValueOnce(MOCK_UPDATE_INFO)

    // Regression: the previous implementation flipped a guard ref before
    // the timer fired, so StrictMode's cleanup-then-rerun pattern left the
    // ref `true` with the only timer already cancelled — the auto-check
    // never ran in dev (production builds skip the double-invoke and were
    // unaffected).
    renderHook(() => useUpdateCheck(true), { wrapper: StrictMode })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(invoke).toHaveBeenCalledWith('check_for_update')
  })

  it('does not auto-check when autoCheck is false', async () => {
    renderHook(() => useUpdateCheck(false))

    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    expect(invoke).not.toHaveBeenCalled()
  })

  it('listens for download progress events', () => {
    renderHook(() => useUpdateCheck())

    expect(listen).toHaveBeenCalledWith(
      'update-download-progress',
      expect.any(Function)
    )
  })

  it('cleans up event listener on unmount', async () => {
    const mockUnlisten = vi.fn()
    ;(listen as Mock).mockResolvedValueOnce(mockUnlisten)

    const { unmount } = renderHook(() => useUpdateCheck())

    // Wait for the listen promise to resolve
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    unmount()
    expect(mockUnlisten).toHaveBeenCalled()
  })

  it('cleans up event listener when unmount happens before listen resolves', async () => {
    const mockUnlisten = vi.fn()
    let resolveListenPromise: (fn: () => void) => void
    ;(listen as Mock).mockReturnValueOnce(
      new Promise<() => void>((resolve) => {
        resolveListenPromise = resolve
      })
    )

    const { unmount } = renderHook(() => useUpdateCheck())

    // Unmount before listen promise resolves
    unmount()

    // Now resolve the listen promise — unlisten should be called immediately
    await act(async () => {
      resolveListenPromise(mockUnlisten)
    })

    expect(mockUnlisten).toHaveBeenCalled()
  })
})
