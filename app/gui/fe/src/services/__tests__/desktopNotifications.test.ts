import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isDesktopNotificationsEnabled,
  setDesktopNotificationsEnabled,
  sendDesktopNotification,
  resetPermissionCache,
} from '../desktopNotifications'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'

describe('desktopNotifications', () => {
  beforeEach(() => {
    localStorage.clear()
    resetPermissionCache()
    vi.clearAllMocks()
  })

  describe('isDesktopNotificationsEnabled / setDesktopNotificationsEnabled', () => {
    it('returns true by default', () => {
      expect(isDesktopNotificationsEnabled()).toBe(true)
    })

    it('persists false', () => {
      setDesktopNotificationsEnabled(false)
      expect(isDesktopNotificationsEnabled()).toBe(false)
    })

    it('persists true', () => {
      setDesktopNotificationsEnabled(false)
      setDesktopNotificationsEnabled(true)
      expect(isDesktopNotificationsEnabled()).toBe(true)
    })
  })

  describe('sendDesktopNotification', () => {
    it('does not call sendNotification when disabled', async () => {
      setDesktopNotificationsEnabled(false)
      await sendDesktopNotification('Title', 'Body')
      expect(sendNotification).not.toHaveBeenCalled()
    })

    it('checks permission and sends notification when enabled', async () => {
      setDesktopNotificationsEnabled(true)
      ;(isPermissionGranted as ReturnType<typeof vi.fn>).mockResolvedValue(true)

      await sendDesktopNotification('New Bid', 'You have a new bid')

      expect(isPermissionGranted).toHaveBeenCalled()
      expect(sendNotification).toHaveBeenCalledWith({
        title: 'New Bid',
        body: 'You have a new bid',
      })
    })

    it('requests permission when not granted', async () => {
      setDesktopNotificationsEnabled(true)
      ;(isPermissionGranted as ReturnType<typeof vi.fn>).mockResolvedValue(false)
      ;(requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue('granted')

      await sendDesktopNotification('Title', 'Body')

      expect(requestPermission).toHaveBeenCalled()
      expect(sendNotification).toHaveBeenCalled()
    })

    it('does not send when permission is denied', async () => {
      setDesktopNotificationsEnabled(true)
      ;(isPermissionGranted as ReturnType<typeof vi.fn>).mockResolvedValue(false)
      ;(requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue('denied')

      await sendDesktopNotification('Title', 'Body')

      expect(sendNotification).not.toHaveBeenCalled()
    })

    it('caches permission result on subsequent calls', async () => {
      setDesktopNotificationsEnabled(true)
      ;(isPermissionGranted as ReturnType<typeof vi.fn>).mockResolvedValue(true)

      await sendDesktopNotification('First', 'first call')
      await sendDesktopNotification('Second', 'second call')

      // isPermissionGranted should only be called once (cached)
      expect(isPermissionGranted).toHaveBeenCalledTimes(1)
      expect(sendNotification).toHaveBeenCalledTimes(2)
    })

    it('resetPermissionCache forces re-check', async () => {
      setDesktopNotificationsEnabled(true)
      ;(isPermissionGranted as ReturnType<typeof vi.fn>).mockResolvedValue(true)

      await sendDesktopNotification('First', 'call')
      expect(isPermissionGranted).toHaveBeenCalledTimes(1)

      resetPermissionCache()
      await sendDesktopNotification('Second', 'call')
      expect(isPermissionGranted).toHaveBeenCalledTimes(2)
    })

    it('handles errors silently', async () => {
      setDesktopNotificationsEnabled(true)
      ;(isPermissionGranted as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Tauri not available'))

      await expect(sendDesktopNotification('Title', 'Body')).resolves.toBeUndefined()
      expect(sendNotification).not.toHaveBeenCalled()
    })
  })
})
