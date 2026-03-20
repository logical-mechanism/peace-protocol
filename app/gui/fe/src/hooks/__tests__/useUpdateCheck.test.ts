import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
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
    })
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
