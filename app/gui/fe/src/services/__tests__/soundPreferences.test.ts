import { describe, it, expect, beforeEach } from 'vitest'
import {
  isMasterSoundEnabled,
  setMasterSoundEnabled,
  isEventSoundEnabled,
  setEventSoundEnabled,
  getEventSoundVolume,
  setEventSoundVolume,
  shouldPlayEvent,
  SOUND_EVENTS,
  type SoundEvent,
} from '../soundPreferences'

describe('soundPreferences', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('master toggle', () => {
    it('returns true by default', () => {
      expect(isMasterSoundEnabled()).toBe(true)
    })

    it('persists false', () => {
      setMasterSoundEnabled(false)
      expect(isMasterSoundEnabled()).toBe(false)
    })

    it('persists true after toggle', () => {
      setMasterSoundEnabled(false)
      setMasterSoundEnabled(true)
      expect(isMasterSoundEnabled()).toBe(true)
    })
  })

  describe('per-event enabled', () => {
    it('returns true by default for all events', () => {
      for (const event of SOUND_EVENTS) {
        expect(isEventSoundEnabled(event)).toBe(true)
      }
    })

    it('persists per-event toggle independently', () => {
      setEventSoundEnabled('new_bid', false)
      expect(isEventSoundEnabled('new_bid')).toBe(false)
      expect(isEventSoundEnabled('tx_confirmed')).toBe(true)
    })
  })

  describe('per-event volume', () => {
    it('returns 0.5 by default', () => {
      for (const event of SOUND_EVENTS) {
        expect(getEventSoundVolume(event)).toBe(0.5)
      }
    })

    it('persists volume', () => {
      setEventSoundVolume('tx_failed', 0.8)
      expect(getEventSoundVolume('tx_failed')).toBe(0.8)
    })

    it('clamps volume to 0', () => {
      setEventSoundVolume('new_bid', -1)
      expect(getEventSoundVolume('new_bid')).toBe(0)
    })

    it('clamps volume to 1', () => {
      setEventSoundVolume('new_bid', 2)
      expect(getEventSoundVolume('new_bid')).toBe(1)
    })

    it('handles NaN in localStorage gracefully', () => {
      localStorage.setItem('veiled_sound_bid_accepted_volume', 'not-a-number')
      expect(getEventSoundVolume('bid_accepted')).toBe(0.5)
    })
  })

  describe('shouldPlayEvent', () => {
    it('returns true when master and event are both enabled', () => {
      expect(shouldPlayEvent('new_bid')).toBe(true)
    })

    it('returns false when master is disabled', () => {
      setMasterSoundEnabled(false)
      expect(shouldPlayEvent('new_bid')).toBe(false)
    })

    it('returns false when event is disabled', () => {
      setEventSoundEnabled('tx_confirmed', false)
      expect(shouldPlayEvent('tx_confirmed')).toBe(false)
    })

    it('returns false when both are disabled', () => {
      setMasterSoundEnabled(false)
      setEventSoundEnabled('tx_failed', false)
      expect(shouldPlayEvent('tx_failed')).toBe(false)
    })
  })

  describe('SOUND_EVENTS', () => {
    it('contains all 4 events', () => {
      expect(SOUND_EVENTS).toEqual(['new_bid', 'tx_confirmed', 'tx_failed', 'bid_accepted'])
    })

    it('events do not share localStorage keys', () => {
      const events: SoundEvent[] = ['new_bid', 'tx_confirmed', 'tx_failed', 'bid_accepted']
      events.forEach((e, i) => setEventSoundVolume(e, (i + 1) * 0.2))
      events.forEach((e, i) => expect(getEventSoundVolume(e)).toBe((i + 1) * 0.2))
    })
  })
})
