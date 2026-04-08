import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  isSoundEnabled,
  setSoundEnabled,
  getSoundVolume,
  setSoundVolume,
  playNotificationSound,
  playSound,
  previewSound,
  _resetAudioElement,
} from '../notificationSound'
import { setMasterSoundEnabled, setEventSoundEnabled, setEventSoundVolume } from '../soundPreferences'

describe('notificationSound', () => {
  beforeEach(() => {
    localStorage.clear()
    _resetAudioElement()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('backwards-compat exports', () => {
    it('isSoundEnabled returns true by default', () => {
      expect(isSoundEnabled()).toBe(true)
    })

    it('setSoundEnabled persists via master toggle', () => {
      setSoundEnabled(false)
      expect(isSoundEnabled()).toBe(false)
    })

    it('getSoundVolume returns 0.5 by default', () => {
      expect(getSoundVolume()).toBe(0.5)
    })

    it('setSoundVolume persists for new_bid event', () => {
      setSoundVolume(0.8)
      expect(getSoundVolume()).toBe(0.8)
    })
  })

  describe('playSound', () => {
    it('does not throw when master is disabled', () => {
      setMasterSoundEnabled(false)
      expect(() => playSound('new_bid')).not.toThrow()
    })

    it('creates audio element with correct path and calls play', () => {
      const mockPlay = vi.fn().mockResolvedValue(undefined)
      const mockAudio = { volume: 1, currentTime: 0, play: mockPlay }
      vi.spyOn(globalThis, 'Audio' as never).mockReturnValue(mockAudio as unknown as HTMLAudioElement)

      setMasterSoundEnabled(true)
      setEventSoundEnabled('tx_confirmed', true)
      setEventSoundVolume('tx_confirmed', 0.7)

      playSound('tx_confirmed')

      expect(globalThis.Audio).toHaveBeenCalledWith('/sounds/tx_confirmed.mp3')
      expect(mockPlay).toHaveBeenCalled()
      expect(mockAudio.volume).toBe(0.7)
      expect(mockAudio.currentTime).toBe(0)
    })

    it('does not call play when event is disabled', () => {
      const mockPlay = vi.fn().mockResolvedValue(undefined)
      vi.spyOn(globalThis, 'Audio' as never).mockReturnValue({
        volume: 1, currentTime: 0, play: mockPlay,
      } as unknown as HTMLAudioElement)

      setEventSoundEnabled('tx_failed', false)
      playSound('tx_failed')

      expect(mockPlay).not.toHaveBeenCalled()
    })

    it('does not call play when master is disabled', () => {
      const mockPlay = vi.fn().mockResolvedValue(undefined)
      vi.spyOn(globalThis, 'Audio' as never).mockReturnValue({
        volume: 1, currentTime: 0, play: mockPlay,
      } as unknown as HTMLAudioElement)

      setMasterSoundEnabled(false)
      playSound('new_bid')

      expect(mockPlay).not.toHaveBeenCalled()
    })

    it('handles play() rejection silently', () => {
      const mockPlay = vi.fn().mockRejectedValue(new Error('Autoplay blocked'))
      vi.spyOn(globalThis, 'Audio' as never).mockReturnValue({
        volume: 1, currentTime: 0, play: mockPlay,
      } as unknown as HTMLAudioElement)

      setMasterSoundEnabled(true)
      expect(() => playSound('new_bid')).not.toThrow()
    })

    it('caches audio elements per event type', () => {
      const mockPlay = vi.fn().mockResolvedValue(undefined)
      vi.spyOn(globalThis, 'Audio' as never).mockReturnValue({
        volume: 1, currentTime: 0, play: mockPlay,
      } as unknown as HTMLAudioElement)

      playSound('new_bid')
      playSound('new_bid')

      // Audio constructor called only once for same event
      expect(globalThis.Audio).toHaveBeenCalledTimes(1)
    })
  })

  describe('previewSound', () => {
    it('plays regardless of enabled state', () => {
      const mockPlay = vi.fn().mockResolvedValue(undefined)
      const mockAudio = { volume: 1, currentTime: 0, play: mockPlay }
      vi.spyOn(globalThis, 'Audio' as never).mockReturnValue(mockAudio as unknown as HTMLAudioElement)

      setMasterSoundEnabled(false)
      setEventSoundEnabled('bid_accepted', false)
      previewSound('bid_accepted', 0.3)

      expect(mockPlay).toHaveBeenCalled()
      expect(mockAudio.volume).toBe(0.3)
    })

    it('uses event volume when no override provided', () => {
      const mockPlay = vi.fn().mockResolvedValue(undefined)
      const mockAudio = { volume: 1, currentTime: 0, play: mockPlay }
      vi.spyOn(globalThis, 'Audio' as never).mockReturnValue(mockAudio as unknown as HTMLAudioElement)

      setEventSoundVolume('tx_confirmed', 0.9)
      previewSound('tx_confirmed')

      expect(mockAudio.volume).toBe(0.9)
    })
  })

  describe('playNotificationSound (backwards compat)', () => {
    it('calls playSound with new_bid', () => {
      const mockPlay = vi.fn().mockResolvedValue(undefined)
      vi.spyOn(globalThis, 'Audio' as never).mockReturnValue({
        volume: 1, currentTime: 0, play: mockPlay,
      } as unknown as HTMLAudioElement)

      setMasterSoundEnabled(true)
      playNotificationSound()

      expect(globalThis.Audio).toHaveBeenCalledWith('/sounds/new_bid.mp3')
      expect(mockPlay).toHaveBeenCalled()
    })
  })
})
