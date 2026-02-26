import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  isSoundEnabled,
  setSoundEnabled,
  getSoundVolume,
  setSoundVolume,
  playNotificationSound,
  _resetAudioElement,
} from '../notificationSound'

// Mock URL.createObjectURL for jsdom
const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url')
const mockRevokeObjectURL = vi.fn()

describe('notificationSound', () => {
  beforeEach(() => {
    localStorage.clear()
    _resetAudioElement()
    vi.restoreAllMocks()
    globalThis.URL.createObjectURL = mockCreateObjectURL
    globalThis.URL.revokeObjectURL = mockRevokeObjectURL
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('isSoundEnabled / setSoundEnabled', () => {
    it('returns true by default', () => {
      expect(isSoundEnabled()).toBe(true)
    })

    it('persists false', () => {
      setSoundEnabled(false)
      expect(isSoundEnabled()).toBe(false)
    })

    it('persists true', () => {
      setSoundEnabled(false)
      setSoundEnabled(true)
      expect(isSoundEnabled()).toBe(true)
    })
  })

  describe('getSoundVolume / setSoundVolume', () => {
    it('returns 0.5 by default', () => {
      expect(getSoundVolume()).toBe(0.5)
    })

    it('persists volume', () => {
      setSoundVolume(0.8)
      expect(getSoundVolume()).toBe(0.8)
    })

    it('clamps volume to 0', () => {
      setSoundVolume(-0.5)
      expect(getSoundVolume()).toBe(0)
    })

    it('clamps volume to 1', () => {
      setSoundVolume(1.5)
      expect(getSoundVolume()).toBe(1)
    })

    it('handles NaN in localStorage gracefully', () => {
      localStorage.setItem('veiled_notification_sound_volume', 'not-a-number')
      expect(getSoundVolume()).toBe(0.5) // falls back to default
    })
  })

  describe('playNotificationSound', () => {
    it('does not throw when sound is disabled', () => {
      setSoundEnabled(false)
      expect(() => playNotificationSound()).not.toThrow()
    })

    it('creates audio element and calls play when enabled', () => {
      const mockPlay = vi.fn().mockResolvedValue(undefined)
      const mockAudio = {
        volume: 1,
        currentTime: 0,
        play: mockPlay,
      }
      vi.spyOn(globalThis, 'Audio' as never).mockReturnValue(mockAudio as unknown as HTMLAudioElement)

      setSoundEnabled(true)
      setSoundVolume(0.7)

      playNotificationSound()

      expect(mockPlay).toHaveBeenCalled()
      expect(mockAudio.volume).toBe(0.7)
      expect(mockAudio.currentTime).toBe(0)
    })

    it('does not call play when disabled', () => {
      const mockPlay = vi.fn().mockResolvedValue(undefined)
      vi.spyOn(globalThis, 'Audio' as never).mockReturnValue({
        volume: 1,
        currentTime: 0,
        play: mockPlay,
      } as unknown as HTMLAudioElement)

      setSoundEnabled(false)
      playNotificationSound()

      expect(mockPlay).not.toHaveBeenCalled()
    })

    it('handles play() rejection silently', () => {
      const mockPlay = vi.fn().mockRejectedValue(new Error('Autoplay blocked'))
      vi.spyOn(globalThis, 'Audio' as never).mockReturnValue({
        volume: 1,
        currentTime: 0,
        play: mockPlay,
      } as unknown as HTMLAudioElement)

      setSoundEnabled(true)
      expect(() => playNotificationSound()).not.toThrow()
    })
  })
})
