import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface UpdateInfo {
  current_version: string
  latest_version: string
  update_available: boolean
  download_url: string
  release_notes: string
  published_at: string
  download_size: number | null
}

export interface DownloadProgress {
  downloaded_bytes: number
  total_bytes: number
  percent: number
  bytes_per_sec: number
}

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date'; info: UpdateInfo }
  | { status: 'available'; info: UpdateInfo }
  | { status: 'dismissed' }
  | { status: 'downloading'; progress: DownloadProgress }
  | { status: 'downloaded'; filePath: string }
  | { status: 'error'; message: string }

export function useUpdateCheck(autoCheck = false) {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  const dismissedRef = useRef(false)
  const startupCheckedRef = useRef(false)

  // Listen for download progress events
  useEffect(() => {
    let mounted = true
    let unlisten: UnlistenFn | undefined
    listen<DownloadProgress>('update-download-progress', (event) => {
      setState((prev) => {
        if (prev.status === 'downloading') {
          return { status: 'downloading', progress: event.payload }
        }
        return prev
      })
    }).then((fn) => {
      if (mounted) {
        unlisten = fn
      } else {
        fn() // already unmounted, clean up immediately
      }
    })
    return () => {
      mounted = false
      unlisten?.()
    }
  }, [])

  const checkForUpdate = useCallback(async () => {
    setState({ status: 'checking' })
    try {
      const info = await invoke<UpdateInfo>('check_for_update')
      if (info.update_available) {
        setState({ status: 'available', info })
      } else {
        setState({ status: 'up-to-date', info })
      }
      return info
    } catch (err) {
      setState({ status: 'error', message: `${err}` })
      return null
    }
  }, [])

  const downloadUpdate = useCallback(
    async (downloadUrl: string, expectedSize?: number | null) => {
      setState({
        status: 'downloading',
        progress: { downloaded_bytes: 0, total_bytes: expectedSize ?? 0, percent: 0, bytes_per_sec: 0 },
      })
      try {
        const filePath = await invoke<string>('download_update', {
          downloadUrl,
          expectedSize: expectedSize ?? null,
        })
        setState({ status: 'downloaded', filePath })
        return filePath
      } catch (err) {
        setState({ status: 'error', message: `${err}` })
        return null
      }
    },
    [],
  )

  const dismiss = useCallback(() => {
    dismissedRef.current = true
    setState({ status: 'dismissed' })
  }, [])

  const reset = useCallback(() => {
    setState({ status: 'idle' })
  }, [])

  // Auto-check on mount when enabled. The guard is set inside the timeout
  // callback (not in the effect body) so React StrictMode's double-invoke in
  // dev — setup → cleanup → setup — cannot leave the ref `true` with the
  // first timer already cancelled, which would skip the second scheduling
  // and prevent the check from ever firing.
  useEffect(() => {
    if (!autoCheck) return
    const timer = setTimeout(() => {
      if (startupCheckedRef.current || dismissedRef.current) return
      startupCheckedRef.current = true
      checkForUpdate()
    }, 3000)
    return () => clearTimeout(timer)
  }, [autoCheck, checkForUpdate])

  return { state, checkForUpdate, downloadUpdate, dismiss, reset }
}
