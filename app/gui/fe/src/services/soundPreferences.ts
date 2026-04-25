/**
 * Per-event sound preference service.
 *
 * Stores enabled/disabled + volume for each notification sound event,
 * plus a global master toggle. Backed by localStorage.
 */

import { storageGet, storageSet } from './storageUtils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SoundEvent = 'new_bid' | 'tx_confirmed' | 'tx_failed' | 'bid_accepted'

export const SOUND_EVENTS: readonly SoundEvent[] = [
  'new_bid',
  'tx_confirmed',
  'tx_failed',
  'bid_accepted',
] as const

/** i18n keys for sound event labels — resolve via t(`settings:preferences.soundEvents.${key}`) */
export const SOUND_EVENT_KEYS: Record<SoundEvent, { labelKey: string; descKey: string }> = {
  new_bid: { labelKey: 'preferences.soundEvents.new_bid', descKey: 'preferences.soundEvents.new_bidDesc' },
  tx_confirmed: { labelKey: 'preferences.soundEvents.tx_confirmed', descKey: 'preferences.soundEvents.tx_confirmedDesc' },
  tx_failed: { labelKey: 'preferences.soundEvents.tx_failed', descKey: 'preferences.soundEvents.tx_failedDesc' },
  bid_accepted: { labelKey: 'preferences.soundEvents.bid_accepted', descKey: 'preferences.soundEvents.bid_acceptedDesc' },
}

// ---------------------------------------------------------------------------
// localStorage keys
// ---------------------------------------------------------------------------

const MASTER_KEY = 'veiled_sound_master_enabled'
const eventKey = (event: SoundEvent, suffix: 'enabled' | 'volume') =>
  `veiled_sound_${event}_${suffix}`

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_ENABLED = true
const DEFAULT_VOLUME = 0.5

// ---------------------------------------------------------------------------
// Master toggle
// ---------------------------------------------------------------------------

export function isMasterSoundEnabled(): boolean {
  const stored = storageGet(MASTER_KEY)
  return stored !== null ? stored === 'true' : DEFAULT_ENABLED
}

export function setMasterSoundEnabled(enabled: boolean): void {
  storageSet(MASTER_KEY, String(enabled))
}

// ---------------------------------------------------------------------------
// Per-event enabled
// ---------------------------------------------------------------------------

export function isEventSoundEnabled(event: SoundEvent): boolean {
  const stored = storageGet(eventKey(event, 'enabled'))
  return stored !== null ? stored === 'true' : DEFAULT_ENABLED
}

export function setEventSoundEnabled(event: SoundEvent, enabled: boolean): void {
  storageSet(eventKey(event, 'enabled'), String(enabled))
}

// ---------------------------------------------------------------------------
// Per-event volume
// ---------------------------------------------------------------------------

export function getEventSoundVolume(event: SoundEvent): number {
  const stored = storageGet(eventKey(event, 'volume'))
  if (stored !== null) {
    const v = Number(stored)
    return isNaN(v) ? DEFAULT_VOLUME : Math.max(0, Math.min(1, v))
  }
  return DEFAULT_VOLUME
}

export function setEventSoundVolume(event: SoundEvent, volume: number): void {
  storageSet(eventKey(event, 'volume'), String(Math.max(0, Math.min(1, volume))))
}

// ---------------------------------------------------------------------------
// Convenience: check if a given event should play
// ---------------------------------------------------------------------------

export function shouldPlayEvent(event: SoundEvent): boolean {
  return isMasterSoundEnabled() && isEventSoundEnabled(event)
}
